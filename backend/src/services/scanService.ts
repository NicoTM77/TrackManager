import { eq, and, inArray, like, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { libraries, mediaItems, audioTracks, subtitleTracks, auditResults, rules, seriesMetadata } from '../db/schema';
import { crawlDirectory, CrawledFile } from '../utils/crawler';
import { parseMediaFile, ParsedMediaMetadata } from '../utils/mediainfo';
import logger from '../utils/logger';
import fs from 'fs';

const CONCURRENT_SCAN_THREADS = parseInt(process.env.CONCURRENT_SCAN_THREADS || '4', 10);

/**
 * Executes async tasks concurrently with a maximum concurrency limit.
 */
async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  });
  
  await Promise.all(workers);
  return results;
}

// In-memory serialized database write queue to prevent SQLITE_BUSY
let dbWriteQueue = Promise.resolve();
async function enqueueDbWrite<T>(writeFn: () => Promise<T>): Promise<T> {
  const resultPromise = dbWriteQueue.then(writeFn);
  dbWriteQueue = resultPromise.then(() => {}).catch(() => {});
  return resultPromise;
}

export interface ScanSummary {
  libraryName: string;
  totalFoundOnDisk: number;
  skippedFastPath: number;
  newParsed: number;
  restored: number;
  moved: number;
  removed: number;
  failed: number;
}

/**
 * Runs a recursive filesystem audit scan on a specific media library.
 * Emits trace/debug logging for all parsed files and maps state changes inside secure SQLite transactions.
 * 
 * @param libraryId The ID of the configured library to scan.
 * @returns ScanSummary with stats of the scan operation.
 */
export async function scanLibrary(libraryId: number): Promise<ScanSummary> {
  const library = await db.query.libraries.findFirst({
    where: eq(libraries.id, libraryId),
  });

  if (!library) {
    logger.error(`Scan aborted: Library with ID ${libraryId} not found in database.`);
    throw new Error(`Library not found: ${libraryId}`);
  }

  logger.info(`Starting audit scan for library "${library.name}" [Type: ${library.type}] at path: ${library.path}`);

  // 0. Compliance cache pruning for disabled rules
  try {
    const inactiveRules = await db
      .select({ id: rules.id })
      .from(rules)
      .where(eq(rules.isActive, false));
    const inactiveRuleIds = inactiveRules.map((r) => r.id);
    if (inactiveRuleIds.length > 0) {
      await db
        .delete(auditResults)
        .where(inArray(auditResults.ruleId, inactiveRuleIds));
      logger.debug(`Pruned audit results cache for ${inactiveRuleIds.length} inactive compliance rules.`);
    }
  } catch (pruneError: any) {
    logger.error(pruneError, 'Failed to prune compliance cache for inactive rules.');
  }

  // 1. Crawl filesystem for all video files
  const diskFiles = crawlDirectory(library.path);
  const diskFilesMap = new Map<string, CrawledFile>();
  for (const file of diskFiles) {
    diskFilesMap.set(file.filePath, file);
  }

  // 2. Load current database records for this library
  const dbRecords = await db
    .select()
    .from(mediaItems)
    .where(eq(mediaItems.libraryId, libraryId));

  const dbRecordsMap = new Map<string, typeof mediaItems.$inferSelect>();
  for (const record of dbRecords) {
    dbRecordsMap.set(record.filePath, record);
  }

  const summary: ScanSummary = {
    libraryName: library.name,
    totalFoundOnDisk: diskFiles.length,
    skippedFastPath: 0,
    newParsed: 0,
    restored: 0,
    moved: 0,
    removed: 0,
    failed: 0,
  };

  // 3. Track files that are missing from disk to process for moves or removals
  const missingFromDisk: (typeof mediaItems.$inferSelect)[] = [];
  for (const record of dbRecords) {
    if (record.status === 'active' && !diskFilesMap.has(record.filePath)) {
      missingFromDisk.push(record);
    }
  }

  // Track potential new additions
  const newOnDisk: CrawledFile[] = [];
  for (const file of diskFiles) {
    if (!dbRecordsMap.has(file.filePath)) {
      newOnDisk.push(file);
    }
  }

  // 4. Rename / Move Detection
  // If a new file is found on disk, and a missing file exists in DB with matching size and basename,
  // we update its path to prevent losing its ID, history, and audit associations.
  const movedDiskPaths = new Set<string>();
  const movedDbIds = new Set<number>();

  for (const newFile of newOnDisk) {
    // Look for a missing DB record with exact match on size and basename
    const matchedRecord = missingFromDisk.find(
      (record) =>
        !movedDbIds.has(record.id) &&
        record.fileSize === newFile.fileSize &&
        record.fileName === newFile.fileName
    );

    if (matchedRecord) {
      logger.info(`Rename/Move detected: "${matchedRecord.filePath}" ➜ "${newFile.filePath}"`);
      
      try {
        await db.transaction((tx) => {
          tx
            .update(mediaItems)
            .set({
              filePath: newFile.filePath,
              mtimeMs: newFile.mtimeMs,
              status: 'active',
              removedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(mediaItems.id, matchedRecord.id))
            .run();
        });

        movedDiskPaths.add(newFile.filePath);
        movedDbIds.add(matchedRecord.id);
        summary.moved++;
      } catch (error: any) {
        logger.error(`Failed to execute path move transaction for ID ${matchedRecord.id}:`, error);
        summary.failed++;
      }
    }
  }

  // Filter out files that were processed as moves
  const remainingNewOnDisk = newOnDisk.filter((file) => !movedDiskPaths.has(file.filePath));
  const remainingMissingFromDisk = missingFromDisk.filter((record) => !movedDbIds.has(record.id));

  // 5. Flag Removed Content
  // Any remaining missing active records are flagged as removed.
  for (const record of remainingMissingFromDisk) {
    logger.info(`Flagging deleted/missing file: "${record.filePath}"`);
    try {
      await db.transaction((tx) => {
        tx
          .update(mediaItems)
          .set({
            status: 'removed',
            removedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(mediaItems.id, record.id))
          .run();
      });
      summary.removed++;
    } catch (error: any) {
      logger.error(`Failed to flag removed file ID ${record.id}:`, error);
      summary.failed++;
    }
  }

  // 6. Fast Path Optimization
  // Process files existing both on disk and in database, skipping parsing if size/mtime match.
  const modifiedFilesToReparse: { recordId: number; file: CrawledFile }[] = [];

  for (const file of diskFiles) {
    // If it was already processed as a move, skip
    if (movedDiskPaths.has(file.filePath)) continue;

    const record = dbRecordsMap.get(file.filePath);
    if (!record) continue;

    if (record.fileSize === file.fileSize && record.mtimeMs === file.mtimeMs) {
      // Fast path match!
      if (record.status === 'removed') {
        // Restore deleted file to active if it returned
        logger.info(`Restoring previously removed file to active: "${file.filePath}"`);
        try {
          await db
            .update(mediaItems)
            .set({ status: 'active', removedAt: null, updatedAt: new Date() })
            .where(eq(mediaItems.id, record.id));
          summary.restored++;
        } catch (error: any) {
          logger.error(`Failed to restore file ID ${record.id}:`, error);
          summary.failed++;
        }
      } else {
        logger.trace(`Fast-path matched (skipping): ${file.filePath}`);
        summary.skippedFastPath++;
      }
    } else {
      // File has changed - queue it for concurrent re-parsing
      modifiedFilesToReparse.push({ recordId: record.id, file });
    }
  }

  // Concurrently parse modified files and sequentially update the database
  if (modifiedFilesToReparse.length > 0) {
    logger.info(`Concurrent Scan: Re-parsing ${modifiedFilesToReparse.length} modified files using ${CONCURRENT_SCAN_THREADS} workers.`);
    await promisePool(modifiedFilesToReparse, CONCURRENT_SCAN_THREADS, async (item) => {
      logger.debug(`File modification detected (re-parsing): ${item.file.filePath}`);
      try {
        const meta = await parseMediaFile(item.file.filePath);
        await enqueueDbWrite(() =>
          updateMediaItemTransaction(item.recordId, meta, item.file.fileSize, item.file.mtimeMs)
        );
        summary.newParsed++;
      } catch (error: any) {
        logger.error(`Failed to re-parse modified file "${item.file.filePath}":`, error);
        summary.failed++;
      }
    });
  }

  // 7. Parse Brand New Additions
  // Parse newly discovered files using MediaInfo concurrently and load them inside structured database transactions sequentially.
  if (remainingNewOnDisk.length > 0) {
    logger.info(`Concurrent Scan: Parsing ${remainingNewOnDisk.length} brand new additions using ${CONCURRENT_SCAN_THREADS} workers.`);
    await promisePool(remainingNewOnDisk, CONCURRENT_SCAN_THREADS, async (file) => {
      logger.debug(`Discovered new file (parsing): ${file.filePath}`);
      try {
        const meta = await parseMediaFile(file.filePath);
        await enqueueDbWrite(() =>
          createMediaItemTransaction(libraryId, file.filePath, file.fileName, file.fileSize, file.mtimeMs, meta)
        );
        summary.newParsed++;
      } catch (error: any) {
        logger.error(`Failed to parse newly discovered file "${file.filePath}":`, error);
        summary.failed++;
      }
    });
  }

  // 7.5. Series Metadata Cascade Cleanup
  // Check if any series_metadata is registered for this library, and if all of its episodes 
  // are marked as removed (no active mediaItems exist under the series folder path),
  // delete the series_metadata configuration to prevent cluttering the database.
  if (library.type === 'tv') {
    try {
      const activeSeriesMetadata = await db
        .select()
        .from(seriesMetadata)
        .where(eq(seriesMetadata.libraryId, libraryId));

      for (const meta of activeSeriesMetadata) {
        // Count active media items matching the series path prefix
        const [activeCountRes] = await db
          .select({ count: sql<number>`count(*)` })
          .from(mediaItems)
          .where(
            and(
              eq(mediaItems.libraryId, libraryId),
              eq(mediaItems.status, 'active'),
              like(mediaItems.filePath, `${meta.seriesPath}%`)
            )
          );
        
        const activeCount = activeCountRes ? activeCountRes.count : 0;
        if (activeCount === 0) {
          logger.info(`Cascade cleanup: No active items remaining for series "${meta.seriesName}". Deleting series metadata configuration.`);
          await db
            .delete(seriesMetadata)
            .where(eq(seriesMetadata.id, meta.id));
        }
      }
    } catch (cascadeError: any) {
      logger.error(cascadeError, 'Failed to execute series metadata cascade cleanup.');
    }
  }

  // 8. Run compliance audits for all active files in this library
  try {
    const { runLibraryAudits } = await import('./auditService');
    await runLibraryAudits(libraryId);
  } catch (error: any) {
    logger.error(error, `Failed to execute compliance audits for library ID ${libraryId}`);
  }

  logger.info(`Sync complete for library "${library.name}". Summary: 
    - Total Found on Disk: ${summary.totalFoundOnDisk}
    - Fast Path Skipped:   ${summary.skippedFastPath}
    - Restored Files:      ${summary.restored}
    - Moved/Renamed:       ${summary.moved}
    - Newly Parsed:        ${summary.newParsed}
    - Removed/Flagged:     ${summary.removed}
    - Failed Items:        ${summary.failed}`
  );

  return summary;
}

/**
 * Creates a brand new MediaItem along with its child tracks within a secure SQLite Transaction.
 */
async function createMediaItemTransaction(
  libraryId: number,
  filePath: string,
  fileName: string,
  fileSize: number,
  mtimeMs: number,
  meta: ParsedMediaMetadata
) {

  await db.transaction((tx) => {
    // 1. Insert core Media Item details
    const [inserted] = tx
      .insert(mediaItems)
      .values({
        libraryId,
        filePath,
        fileName,
        fileSize,
        mtimeMs,
        status: 'active',
        scannedAt: new Date(),
        title: meta.title,
        season: meta.season,
        episode: meta.episode,
        container: meta.container,
        videoResolution: meta.videoResolution,
        videoBitrate: meta.videoBitrate,
        videoCodec: meta.videoCodec,
        videoColorDepth: meta.videoColorDepth,
        videoHdrFormat: meta.videoHdrFormat,
        rawMetadata: meta.rawMetadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .all();

    // 2. Insert child Audio tracks
    if (meta.audioTracks.length > 0) {
      tx.insert(audioTracks).values(
        meta.audioTracks.map((track) => ({
          mediaItemId: inserted.id,
          trackIndex: track.trackIndex,
          language: track.language,
          format: track.format,
          channels: track.channels,
          bitrate: track.bitrate,
          isDefault: track.isDefault,
          isForced: track.isForced,
        }))
      ).run();
    }

    // 3. Insert child Subtitle tracks
    if (meta.subtitleTracks.length > 0) {
      tx.insert(subtitleTracks).values(
        meta.subtitleTracks.map((track) => ({
          mediaItemId: inserted.id,
          trackIndex: track.trackIndex,
          language: track.language,
          format: track.format,
          isDefault: track.isDefault,
          isForced: track.isForced,
          isHearingImpaired: track.isHearingImpaired,
        }))
      ).run();
    }
  });
}

/**
 * Updates an existing MediaItem's child tracks by deleting old child records and re-inserting them inside an atomic transaction.
 */
async function updateMediaItemTransaction(
  mediaItemId: number,
  meta: ParsedMediaMetadata,
  fileSize: number,
  mtimeMs: number
) {
  await db.transaction((tx) => {
    // 1. Update core Media Item stats
    tx
      .update(mediaItems)
      .set({
        fileSize,
        mtimeMs,
        scannedAt: new Date(),
        title: meta.title,
        season: meta.season,
        episode: meta.episode,
        container: meta.container,
        videoResolution: meta.videoResolution,
        videoBitrate: meta.videoBitrate,
        videoCodec: meta.videoCodec,
        videoColorDepth: meta.videoColorDepth,
        videoHdrFormat: meta.videoHdrFormat,
        rawMetadata: meta.rawMetadata,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaItemId))
      .run();

    // 2. Clear old children (cascade delete would run, but let's be explicit and clear audio/subtitle lists)
    tx.delete(audioTracks).where(eq(audioTracks.mediaItemId, mediaItemId)).run();
    tx.delete(subtitleTracks).where(eq(subtitleTracks.mediaItemId, mediaItemId)).run();
    tx.delete(auditResults).where(eq(auditResults.mediaItemId, mediaItemId)).run();

    // 3. Re-insert new Audio child records
    if (meta.audioTracks.length > 0) {
      tx.insert(audioTracks).values(
        meta.audioTracks.map((track) => ({
          mediaItemId,
          trackIndex: track.trackIndex,
          language: track.language,
          format: track.format,
          channels: track.channels,
          bitrate: track.bitrate,
          isDefault: track.isDefault,
          isForced: track.isForced,
        }))
      ).run();
    }

    // 4. Re-insert new Subtitle child records
    if (meta.subtitleTracks.length > 0) {
      tx.insert(subtitleTracks).values(
        meta.subtitleTracks.map((track) => ({
          mediaItemId,
          trackIndex: track.trackIndex,
          language: track.language,
          format: track.format,
          isDefault: track.isDefault,
          isForced: track.isForced,
          isHearingImpaired: track.isHearingImpaired,
        }))
      ).run();
    }
  });
}
