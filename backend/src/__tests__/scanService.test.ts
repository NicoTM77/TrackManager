import { describe, it, expect, vi, beforeAll } from 'vitest';

// Configure environment variables immediately in the module scope
process.env.DATABASE_URL = ':memory:';
process.env.NODE_ENV = 'test';

// Simple Mutex to guarantee 100% serial execution of async tests,
// eliminating any possible database race conditions or mock pollution in Vitest.
class Mutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = nextPromise;
    await currentPromise;
    return release!;
  }
}

const testMutex = new Mutex();

// Declare variables to be resolved via dynamic runtime imports
let db: any;
let initializeDatabase: any;
let scanLibrary: any;
let libraries: any;
let mediaItems: any;
let audioTracks: any;
let subtitleTracks: any;
let rulesSchema: any;
let auditResultsSchema: any;

// Mock the recursive directory crawler and MediaInfo parser
vi.mock('../utils/crawler', () => ({
  crawlDirectory: vi.fn(),
}));

vi.mock('../utils/mediainfo', () => ({
  parseMediaFile: vi.fn(),
}));

import * as crawler from '../utils/crawler';
import * as mediainfo from '../utils/mediainfo';

describe('Library Indexer & Incremental Sync Engine Tests', () => {
  beforeAll(async () => {
    // Dynamic imports at runtime completely bypass ES6 static hoisting,
    // ensuring process.env.DATABASE_URL is set before the SQLite connector evaluates.
    const connection = await import('../db/connection');
    db = connection.db;
    initializeDatabase = connection.initializeDatabase;

    const schema = await import('../db/schema');
    libraries = schema.libraries;
    mediaItems = schema.mediaItems;
    audioTracks = schema.audioTracks;
    subtitleTracks = schema.subtitleTracks;
    rulesSchema = schema.rules;
    auditResultsSchema = schema.auditResults;

    const scanner = await import('../services/scanService');
    scanLibrary = scanner.scanLibrary;

    // Initialize in-memory tables and run migrations
    await initializeDatabase();
  });

  // Helper to isolate database state safely inside the mutex lock
  async function resetDatabaseState(): Promise<number> {
    await db.delete(auditResultsSchema);
    await db.delete(rulesSchema);
    await db.delete(audioTracks);
    await db.delete(subtitleTracks);
    await db.delete(mediaItems);
    await db.delete(libraries);

    const [lib] = await db
      .insert(libraries)
      .values({
        name: 'Test Movies',
        path: '/mock/media/movies',
        type: 'movie',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    vi.clearAllMocks();
    return lib.id;
  }

  it('should successfully index new media items found on disk', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      const mockFiles: crawler.CrawledFile[] = [
        {
          filePath: '/mock/media/movies/Inception_New.mkv',
          fileName: 'Inception_New.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
        },
      ];

      const mockMeta: mediainfo.ParsedMediaMetadata = {
        container: 'mkv',
        fileSize: 1000000000,
        title: 'Inception',
        season: null,
        episode: null,
        videoResolution: '3840x2160',
        videoBitrate: 8000000,
        videoCodec: 'HEVC',
        videoColorDepth: 10,
        videoHdrFormat: 'HDR10',
        audioTracks: [
          {
            trackIndex: 1,
            language: 'eng',
            format: 'TrueHD (Atmos)',
            channels: 8,
            bitrate: 450000,
            isDefault: true,
            isForced: false,
          },
        ],
        subtitleTracks: [
          {
            trackIndex: 2,
            language: 'eng',
            format: 'SRT',
            isDefault: false,
            isForced: false,
            isHearingImpaired: true,
          },
        ],
        rawMetadata: '{}',
      };

      // Configure mocks
      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);
      vi.mocked(mediainfo.parseMediaFile).mockResolvedValue(mockMeta);

      // Run sync scan
      const summary = await scanLibrary(libraryId);

      expect(summary.totalFoundOnDisk).toBe(1);
      expect(summary.newParsed).toBe(1);
      expect(summary.skippedFastPath).toBe(0);

      // Assert database contains correct records
      const insertedItems = await db.select().from(mediaItems);
      expect(insertedItems.length).toBe(1);
      expect(insertedItems[0].title).toBe('Inception');
      expect(insertedItems[0].status).toBe('active');
      expect(insertedItems[0].videoCodec).toBe('HEVC');
      expect(insertedItems[0].videoHdrFormat).toBe('HDR10');

      const insertedAudios = await db.select().from(audioTracks);
      expect(insertedAudios.length).toBe(1);
      expect(insertedAudios[0].format).toBe('TrueHD (Atmos)');
      expect(insertedAudios[0].language).toBe('eng');

      const insertedSubs = await db.select().from(subtitleTracks);
      expect(insertedSubs.length).toBe(1);
      expect(insertedSubs[0].format).toBe('SRT');
      expect(insertedSubs[0].isHearingImpaired).toBe(true);
    } finally {
      release();
    }
  });

  it('should skip parsing on subsequent scans if file mtime and size match (Fast Path)', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      const mockFiles: crawler.CrawledFile[] = [
        {
          filePath: '/mock/media/movies/Inception_Fast.mkv',
          fileName: 'Inception_Fast.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
        },
      ];

      const mockMeta: mediainfo.ParsedMediaMetadata = {
        container: 'mkv',
        fileSize: 1000000000,
        title: 'Inception',
        season: null,
        episode: null,
        videoResolution: '3840x2160',
        videoBitrate: 8000000,
        videoCodec: 'HEVC',
        videoColorDepth: 10,
        videoHdrFormat: 'HDR10',
        audioTracks: [],
        subtitleTracks: [],
        rawMetadata: '{}',
      };

      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);
      vi.mocked(mediainfo.parseMediaFile).mockResolvedValue(mockMeta);

      // Scan 1: Index file first
      await scanLibrary(libraryId);
      expect(mediainfo.parseMediaFile).toHaveBeenCalledTimes(1);

      // Scan 2: Subsequent scan with same metadata
      vi.clearAllMocks();
      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);

      const summary = await scanLibrary(libraryId);
      
      expect(summary.totalFoundOnDisk).toBe(1);
      expect(summary.newParsed).toBe(0);
      expect(summary.skippedFastPath).toBe(1);
      expect(mediainfo.parseMediaFile).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('should flag media items as removed without deleting them if they are missing from disk', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      // 1. Manually insert an active item to simulate previous scan state
      const [inserted] = await db
        .insert(mediaItems)
        .values({
          libraryId,
          filePath: '/mock/media/movies/Inception_Removed.mkv',
          fileName: 'Inception_Removed.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
          status: 'active',
          scannedAt: new Date(),
          container: 'mkv',
          rawMetadata: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Mock directory walk to return empty disk (file was deleted)
      vi.mocked(crawler.crawlDirectory).mockReturnValue([]);

      // Scan
      const summary = await scanLibrary(libraryId);

      expect(summary.totalFoundOnDisk).toBe(0);
      expect(summary.removed).toBe(1);

      // Assert file status is 'removed' rather than deleted
      const items = await db.select().from(mediaItems);
      const item = items.find((i: any) => i.id === inserted.id);
      expect(item).toBeDefined();
      expect(item!.status).toBe('removed');
      expect(item!.removedAt).toBeInstanceOf(Date);
    } finally {
      release();
    }
  });

  it('should restore status to active if a previously flagged removed item returns to disk', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      // 1. Manually insert a removed item
      const [inserted] = await db
        .insert(mediaItems)
        .values({
          libraryId,
          filePath: '/mock/media/movies/Inception_Restored.mkv',
          fileName: 'Inception_Restored.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
          status: 'removed',
          scannedAt: new Date(),
          removedAt: new Date(),
          container: 'mkv',
          rawMetadata: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Mock directory walk to return the file again on disk
      const mockFiles: crawler.CrawledFile[] = [
        {
          filePath: '/mock/media/movies/Inception_Restored.mkv',
          fileName: 'Inception_Restored.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
        },
      ];
      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);

      // Scan
      const summary = await scanLibrary(libraryId);

      expect(summary.totalFoundOnDisk).toBe(1);
      expect(summary.restored).toBe(1);

      // Assert status is now active and removedAt is cleared
      const items = await db.select().from(mediaItems);
      const item = items.find((i: any) => i.id === inserted.id);
      expect(item).toBeDefined();
      expect(item!.status).toBe('active');
      expect(item!.removedAt).toBeNull();
    } finally {
      release();
    }
  });

  it('should detect renames/moves when file path changes but size and name match', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      // 1. Manually insert an active item representing previous path
      const [inserted] = await db
        .insert(mediaItems)
        .values({
          libraryId,
          filePath: '/mock/media/movies/Old Folder/Inception_Moved.mkv',
          fileName: 'Inception_Moved.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
          status: 'active',
          scannedAt: new Date(),
          container: 'mkv',
          rawMetadata: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // 2. Mock disk crawler to return file in a new moved path
      const mockFiles: crawler.CrawledFile[] = [
        {
          filePath: '/mock/media/movies/New Folder/Inception_Moved.mkv',
          fileName: 'Inception_Moved.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
        },
      ];
      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);

      // Scan
      const summary = await scanLibrary(libraryId);

      expect(summary.moved).toBe(1);
      expect(summary.removed).toBe(0); // Should not mark old path as deleted because move was registered

      // Assert database path was updated inline, maintaining original DB record ID
      const items = await db.select().from(mediaItems);
      const item = items.find((i: any) => i.id === inserted.id);
      expect(item).toBeDefined();
      expect(item!.filePath).toBe('/mock/media/movies/New Folder/Inception_Moved.mkv');
      expect(item!.status).toBe('active');
    } finally {
      release();
    }
  });

  it('should purge cache rows from audit_results for inactive rules before scanning', async () => {
    const release = await testMutex.acquire();
    try {
      const libraryId = await resetDatabaseState();

      // 1. Insert an active rule and an inactive rule
      const [activeRule] = await db
        .insert(rulesSchema)
        .values({
          name: 'Active Rule',
          targetType: 'movie',
          isActive: true,
          conditions: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const [inactiveRule] = await db
        .insert(rulesSchema)
        .values({
          name: 'Inactive Rule',
          targetType: 'movie',
          isActive: false,
          conditions: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // 2. Insert a media item
      const [mediaItem] = await db
        .insert(mediaItems)
        .values({
          libraryId,
          filePath: '/mock/media/movies/Inception_Cache.mkv',
          fileName: 'Inception_Cache.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
          status: 'active',
          scannedAt: new Date(),
          container: 'mkv',
          rawMetadata: '{}',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // 3. Insert audit_results for both rules
      await db.insert(auditResultsSchema).values([
        {
          mediaItemId: mediaItem.id,
          ruleId: activeRule.id,
          passed: true,
          auditedAt: new Date(),
        },
        {
          mediaItemId: mediaItem.id,
          ruleId: inactiveRule.id,
          passed: false,
          auditedAt: new Date(),
        },
      ]);

      // Verify they are initially in the database
      const initialAudits = await db.select().from(auditResultsSchema);
      expect(initialAudits.length).toBe(2);

      // Mock crawlDirectory and parseMediaFile to fast-path skip
      const mockFiles: crawler.CrawledFile[] = [
        {
          filePath: '/mock/media/movies/Inception_Cache.mkv',
          fileName: 'Inception_Cache.mkv',
          fileSize: 1000000000,
          mtimeMs: 1622000000000,
        },
      ];
      vi.mocked(crawler.crawlDirectory).mockReturnValue(mockFiles);

      // 4. Run scan Library
      await scanLibrary(libraryId);

      // 5. Verify the audit result for the inactive rule was pruned
      const remainingAudits = await db.select().from(auditResultsSchema);
      const inactiveRuleAudit = remainingAudits.find((a: any) => a.ruleId === inactiveRule.id);
      expect(inactiveRuleAudit).toBeUndefined();
    } finally {
      release();
    }
  });
});

