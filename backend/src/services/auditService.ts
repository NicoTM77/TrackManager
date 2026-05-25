import { eq, and, inArray, or } from 'drizzle-orm';
import { db } from '../db/connection';
import { mediaItems, audioTracks, subtitleTracks, rules, auditResults, libraries } from '../db/schema';
import { evaluateRule } from './rulesEngine';
import logger from '../utils/logger';

/**
 * Runs all active compliance rules against all active media items in a specific library.
 * Writes audit results inside a secure database transaction.
 * 
 * @param libraryId The ID of the library to audit.
 */
export async function runLibraryAudits(libraryId: number): Promise<void> {
  logger.info(`Running compliance audits for library ID: ${libraryId}`);

  // 1. Fetch library to know its type ('movie' | 'tv')
  const [library] = await db
    .select()
    .from(libraries)
    .where(eq(libraries.id, libraryId))
    .limit(1);

  if (!library) {
    logger.warn(`Audit aborted: Library ID ${libraryId} not found.`);
    return;
  }

  // 2. Fetch all active rules that target this library type (or target 'all')
  const activeRules = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.isActive, true),
        or(eq(rules.targetType, 'all'), eq(rules.targetType, library.type))
      )
    );

  logger.debug(`Found ${activeRules.length} active rules applicable to library type "${library.type}".`);

  // 3. Fetch all active media items in this library
  const items = await db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.libraryId, libraryId),
        eq(mediaItems.status, 'active')
      )
    );

  if (items.length === 0) {
    logger.debug(`No active media items to audit in library "${library.name}".`);
    return;
  }

  // 4. Fetch tracks for all of these media items in bulk
  const itemIds = items.map((i) => i.id);
  const allAudio = await db
    .select()
    .from(audioTracks)
    .where(inArray(audioTracks.mediaItemId, itemIds));

  const allSubtitles = await db
    .select()
    .from(subtitleTracks)
    .where(inArray(subtitleTracks.mediaItemId, itemIds));

  // Map tracks to their respective media items in memory
  const audioMap = new Map<number, typeof audioTracks.$inferSelect[]>();
  for (const track of allAudio) {
    if (!audioMap.has(track.mediaItemId)) {
      audioMap.set(track.mediaItemId, []);
    }
    audioMap.get(track.mediaItemId)!.push(track);
  }

  const subtitleMap = new Map<number, typeof subtitleTracks.$inferSelect[]>();
  for (const track of allSubtitles) {
    if (!subtitleMap.has(track.mediaItemId)) {
      subtitleMap.set(track.mediaItemId, []);
    }
    subtitleMap.get(track.mediaItemId)!.push(track);
  }

  const itemsWithTracks = items.map((item) => ({
    ...item,
    audioTracks: audioMap.get(item.id) || [],
    subtitleTracks: subtitleMap.get(item.id) || [],
  }));

  // 5. Evaluate rules and store results inside a transaction
  logger.debug(`Evaluating rules across ${itemsWithTracks.length} media items...`);
  
  await db.transaction((tx) => {
    // If a media item no longer matches any active rules, we should clean up obsolete audits.
    // However, to keep it simple and correct, we just upsert new compliance results.
    for (const item of itemsWithTracks) {
      for (const rule of activeRules) {
        const result = evaluateRule(rule.conditions, item);

        tx
          .insert(auditResults)
          .values({
            mediaItemId: item.id,
            ruleId: rule.id,
            passed: result.passed,
            errorMessage: result.errorMessage || null,
            auditedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [auditResults.mediaItemId, auditResults.ruleId],
            set: {
              passed: result.passed,
              errorMessage: result.errorMessage || null,
              auditedAt: new Date(),
            },
          })
          .run();
      }
    }
  });

  logger.info(`Compliance audits complete for library "${library.name}".`);
}

/**
 * Runs all applicable compliance audits for a single media item.
 * 
 * @param mediaItemId The ID of the media item to audit.
 */
export async function auditMediaItem(mediaItemId: number): Promise<void> {
  const [item] = await db
    .select()
    .from(mediaItems)
    .where(eq(mediaItems.id, mediaItemId))
    .limit(1);

  if (!item) {
    logger.warn(`Audit aborted: Media item ID ${mediaItemId} not found.`);
    return;
  }

  const [library] = await db
    .select()
    .from(libraries)
    .where(eq(libraries.id, item.libraryId))
    .limit(1);

  if (!library) return;

  const activeRules = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.isActive, true),
        or(eq(rules.targetType, 'all'), eq(rules.targetType, library.type))
      )
    );

  const audio = await db
    .select()
    .from(audioTracks)
    .where(eq(audioTracks.mediaItemId, mediaItemId));

  const subtitles = await db
    .select()
    .from(subtitleTracks)
    .where(eq(subtitleTracks.mediaItemId, mediaItemId));

  const itemWithTracks = {
    ...item,
    audioTracks: audio,
    subtitleTracks: subtitles,
  };

  await db.transaction((tx) => {
    for (const rule of activeRules) {
      const result = evaluateRule(rule.conditions, itemWithTracks);

      tx
        .insert(auditResults)
        .values({
          mediaItemId: item.id,
          ruleId: rule.id,
          passed: result.passed,
          errorMessage: result.errorMessage || null,
          auditedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [auditResults.mediaItemId, auditResults.ruleId],
          set: {
            passed: result.passed,
            errorMessage: result.errorMessage || null,
            auditedAt: new Date(),
          },
        })
        .run();
    }
  });
}
