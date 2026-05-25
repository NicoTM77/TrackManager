import './utils/logger';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { eq, and, or, like, inArray, sql } from 'drizzle-orm';

import logger from './utils/logger';
import { db, initializeDatabase, reconnectDatabase } from './db/connection';
import { libraries, mediaItems, audioTracks, subtitleTracks, rules, auditResults, seriesMetadata } from './db/schema';
import { scanLibrary } from './services/scanService';
import { runLibraryAudits } from './services/auditService';
import { evaluateRule } from './services/rulesEngine';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Background scan status tracker
// libraryId -> 'idle' | 'scanning'
const scanStatusMap = new Map<number, 'idle' | 'scanning'>();
// libraryId -> ISO Date string of last scan completion
const lastScanCompletedMap = new Map<number, string>();

// Global interval registry for scheduled background refreshes
const libraryIntervalMap = new Map<number, NodeJS.Timeout>();

/**
 * Manages background sync intervals for a specific library.
 * Dynamic and idempotent; updates scheduling in real-time.
 */
function refreshLibraryTimer(libraryId: number, intervalSeconds: number | null, isEnabled: boolean) {
  // Clear any existing active schedule
  const existing = libraryIntervalMap.get(libraryId);
  if (existing) {
    clearInterval(existing);
    libraryIntervalMap.delete(libraryId);
  }

  // Schedule a new interval if enabled
  if (isEnabled && intervalSeconds && intervalSeconds > 0) {
    logger.info(`Scheduling background auto-refresh for library ID ${libraryId} every ${intervalSeconds} seconds.`);
    const intervalMs = intervalSeconds * 1000;
    const timer = setInterval(async () => {
      logger.info(`Executing scheduled auto-refresh scan for library ID ${libraryId}`);
      try {
        scanStatusMap.set(libraryId, 'scanning');
        const summary = await scanLibrary(libraryId);
        scanStatusMap.set(libraryId, 'idle');
        lastScanCompletedMap.set(libraryId, new Date().toISOString());
        logger.info(`Scheduled auto-refresh scan completed successfully for library "${summary.libraryName}"`);
      } catch (err: any) {
        scanStatusMap.set(libraryId, 'idle');
        logger.error(err, `Scheduled auto-refresh scan failed for library ID ${libraryId}`);
      }
    }, intervalMs);
    libraryIntervalMap.set(libraryId, timer);
  }
}

// Initialize and start database on server boot
async function startServer() {
  try {
    // 1. Run migrations and connect SQLite
    await initializeDatabase();
    
    // 1.5. Query all libraries and initialize auto-refresh interval loops on boot
    const allLibs = await db.select().from(libraries);
    for (const lib of allLibs) {
      scanStatusMap.set(lib.id, 'idle'); // Set default state

      // Query maximum scannedAt from mediaItems for this library to restore lastScanCompletedMap persistently on restart
      const [maxScanned] = await db
        .select({ maxScan: sql<Date>`max(scanned_at)` })
        .from(mediaItems)
        .where(eq(mediaItems.libraryId, lib.id));
      if (maxScanned && maxScanned.maxScan) {
        const maxScanDate = new Date(maxScanned.maxScan);
        lastScanCompletedMap.set(lib.id, maxScanDate.toISOString());
        logger.info(`Restored last sync completed timestamp for library "${lib.name}" [ID: ${lib.id}]: ${maxScanDate.toISOString()}`);
      }

      refreshLibraryTimer(lib.id, lib.refreshInterval, lib.isAutoRefreshEnabled);
    }
    
    // 2. Start Express app listening
    app.listen(PORT, () => {
      logger.info(`TrackManager Backend API successfully listening at http://localhost:${PORT}`);
    });
  } catch (error: any) {
    logger.error(error, 'FATAL: Failed to initialize SQLite database. Server startup aborted.');
    process.exit(1);
  }
}

// ----------------------------------------------------
// 1. LIBRARIES API
// ----------------------------------------------------

// GET /api/libraries - List all libraries
app.get('/api/libraries', async (req, res) => {
  logger.debug('GET /api/libraries requested');
  try {
    const libs = await db.select().from(libraries);
    const enrichedLibs = libs.map((lib) => ({
      ...lib,
      status: scanStatusMap.get(lib.id) || 'idle',
      lastScannedAt: lastScanCompletedMap.get(lib.id) || null,
    }));
    res.json(enrichedLibs);
  } catch (error: any) {
    logger.error(error, 'Failed to fetch libraries');
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

// POST /api/libraries - Create a new library path
app.post('/api/libraries', async (req, res) => {
  const { name, path: libPath, type } = req.body;
  logger.debug({ name, libPath, type }, 'POST /api/libraries requested');

  if (!name || !libPath || !type) {
    return res.status(400).json({ error: 'Missing required parameters: name, path, type.' });
  }

  if (type !== 'movie' && type !== 'tv') {
    return res.status(400).json({ error: 'Library type must be either "movie" or "tv".' });
  }

  // Ensure path exists, if not, try to create it
  if (!fs.existsSync(libPath)) {
    try {
      fs.mkdirSync(libPath, { recursive: true });
      logger.info(`Auto-created media library directory: ${libPath}`);
    } catch (err: any) {
      logger.warn(`Could not create directory at ${libPath}:`, err);
      // We still allow registering the path, as it might be a network share mounted later
    }
  }

  try {
    const [newLib] = await db
      .insert(libraries)
      .values({
        name,
        path: libPath,
        type,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    scanStatusMap.set(newLib.id, 'idle');
    res.status(201).json(newLib);
  } catch (error: any) {
    logger.error(error, `Failed to register library path: ${libPath}`);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A library with this absolute path already exists.' });
    }
    res.status(500).json({ error: 'Failed to create library path.' });
  }
});

// DELETE /api/libraries/:id - Delete a library configuration
app.delete('/api/libraries/:id', async (req, res) => {
  const libraryId = parseInt(req.params.id, 10);
  if (isNaN(libraryId)) {
    return res.status(400).json({ error: 'Invalid library ID.' });
  }

  try {
    const [lib] = await db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!lib) {
      return res.status(404).json({ error: 'Library not found.' });
    }

    await db.delete(libraries).where(eq(libraries.id, libraryId));
    scanStatusMap.delete(libraryId);
    lastScanCompletedMap.delete(libraryId);

    // Clear background interval timer if registered
    const existingTimer = libraryIntervalMap.get(libraryId);
    if (existingTimer) {
      clearInterval(existingTimer);
      libraryIntervalMap.delete(libraryId);
    }

    logger.info(`Deleted library "${lib.name}" [ID: ${libraryId}]`);
    res.json({ message: `Successfully deleted library: ${lib.name}` });
  } catch (error: any) {
    logger.error(error, `Failed to delete library ID ${libraryId}`);
    res.status(500).json({ error: 'Failed to delete library.' });
  }
});

// PUT /api/libraries/:id - Update library configurations (idempotent, supports auto-refresh)
app.put('/api/libraries/:id', async (req, res) => {
  const libraryId = parseInt(req.params.id, 10);
  if (isNaN(libraryId)) {
    return res.status(400).json({ error: 'Invalid library ID.' });
  }

  const { name, path: libPath, type, refreshInterval, isAutoRefreshEnabled } = req.body;

  try {
    const [existingLib] = await db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!existingLib) {
      return res.status(404).json({ error: 'Library not found.' });
    }

    // Prepare update parameters
    const updateParams: any = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updateParams.name = name;
    if (libPath !== undefined) updateParams.path = libPath;
    if (type !== undefined) updateParams.type = type;
    if (refreshInterval !== undefined) updateParams.refreshInterval = refreshInterval;
    if (isAutoRefreshEnabled !== undefined) updateParams.isAutoRefreshEnabled = isAutoRefreshEnabled;

    // Validate path existence if updated
    if (libPath && libPath !== existingLib.path && !fs.existsSync(libPath)) {
      try {
        fs.mkdirSync(libPath, { recursive: true });
        logger.info(`Auto-created media library directory during update: ${libPath}`);
      } catch (err: any) {
        logger.warn(`Could not create directory at ${libPath}:`, err);
      }
    }

    const [updatedLib] = await db
      .update(libraries)
      .set(updateParams)
      .where(eq(libraries.id, libraryId))
      .returning();

    // Dynamically update background auto-refresh scheduling
    const finalInterval = updatedLib.refreshInterval;
    const finalEnabled = updatedLib.isAutoRefreshEnabled;
    refreshLibraryTimer(libraryId, finalInterval, finalEnabled);

    res.json(updatedLib);
  } catch (error: any) {
    logger.error(error, `Failed to update library ID ${libraryId}`);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A library with this absolute path already exists.' });
    }
    res.status(500).json({ error: 'Failed to update library config.' });
  }
});

// POST /api/series/flag - Idempotently flag a series as TV or Anime
app.post('/api/series/flag', async (req, res) => {
  const { libraryId, seriesPath, seriesName, type } = req.body;

  if (!libraryId || !seriesPath || !seriesName || !type) {
    return res.status(400).json({ error: 'Missing required parameters: libraryId, seriesPath, seriesName, type.' });
  }

  if (type !== 'tv' && type !== 'anime') {
    return res.status(400).json({ error: 'Invalid series type. Must be either "tv" or "anime".' });
  }

  try {
    // Check if metadata row already exists
    const [existing] = await db
      .select()
      .from(seriesMetadata)
      .where(eq(seriesMetadata.seriesPath, seriesPath))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(seriesMetadata)
        .set({
          type,
          updatedAt: new Date()
        })
        .where(eq(seriesMetadata.id, existing.id))
        .returning();
      res.json(updated);
    } else {
      const [inserted] = await db
        .insert(seriesMetadata)
        .values({
          libraryId,
          seriesPath,
          seriesName,
          type,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      res.json(inserted);
    }
  } catch (error: any) {
    logger.error(error, `Failed to flag series at path "${seriesPath}" as ${type}`);
    res.status(500).json({ error: 'Failed to save series metadata state.' });
  }
});

// GET /api/series/metadata - Retrieve series taxonomy classifications
app.get('/api/series/metadata', async (req, res) => {
  try {
    const list = await db.select().from(seriesMetadata);
    res.json(list);
  } catch (error: any) {
    logger.error(error, 'Failed to fetch series metadata list');
    res.status(500).json({ error: 'Failed to fetch series classifications.' });
  }
});

// POST /api/libraries/:id/scan - Trigger a background scan
app.post('/api/libraries/:id/scan', async (req, res) => {
  const libraryId = parseInt(req.params.id, 10);
  logger.debug({ libraryId }, 'POST /api/libraries/:id/scan requested');
  if (isNaN(libraryId)) {
    return res.status(400).json({ error: 'Invalid library ID.' });
  }

  try {
    const [lib] = await db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!lib) {
      return res.status(404).json({ error: 'Library not found.' });
    }

    if (scanStatusMap.get(libraryId) === 'scanning') {
      return res.status(409).json({ error: 'Scan already in progress for this library.' });
    }

    // Mark as scanning immediately
    scanStatusMap.set(libraryId, 'scanning');

    // Run the scan asynchronously in the background
    scanLibrary(libraryId)
      .then((summary) => {
        logger.info(`Background scan finished successfully for library "${lib.name}"`);
        scanStatusMap.set(libraryId, 'idle');
        lastScanCompletedMap.set(libraryId, new Date().toISOString());
      })
      .catch((error) => {
        logger.error(error, `Background scan failed for library "${lib.name}"`);
        scanStatusMap.set(libraryId, 'idle');
      });

    res.status(202).json({ message: 'Scan triggered in background.', libraryId });
  } catch (error: any) {
    logger.error(error, `Failed to start scan for library ID ${libraryId}`);
    res.status(500).json({ error: 'Failed to start library scan.' });
  }
});

// POST /api/libraries/:id/audit - Trigger an isolated database-only compliance audit
app.post('/api/libraries/:id/audit', async (req, res) => {
  const libraryId = parseInt(req.params.id, 10);
  logger.debug({ libraryId }, 'POST /api/libraries/:id/audit requested');
  if (isNaN(libraryId)) {
    return res.status(400).json({ error: 'Invalid library ID.' });
  }

  try {
    const [lib] = await db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!lib) {
      return res.status(404).json({ error: 'Library not found.' });
    }

    if (scanStatusMap.get(libraryId) === 'scanning') {
      return res.status(409).json({ error: 'Cannot run audits while a scan is in progress.' });
    }

    logger.info(`Running isolated database audits for library "${lib.name}" [ID: ${libraryId}]`);
    await runLibraryAudits(libraryId);

    res.json({ message: `Audits executed successfully for library: ${lib.name}` });
  } catch (error: any) {
    logger.error(error, `Failed to execute isolated audits for library ID ${libraryId}`);
    res.status(500).json({ error: 'Failed to execute library audits.' });
  }
});

// ----------------------------------------------------
// 2. RULES API
// ----------------------------------------------------

// GET /api/rules - List all compliance rules
app.get('/api/rules', async (req, res) => {
  try {
    const activeRules = await db.select().from(rules);
    const parsedRules = activeRules.map((rule) => ({
      ...rule,
      conditions: JSON.parse(rule.conditions),
    }));
    res.json(parsedRules);
  } catch (error: any) {
    logger.error(error, 'Failed to fetch rules');
    res.status(500).json({ error: 'Failed to fetch compliance rules.' });
  }
});

// POST /api/rules - Create a new rule
app.post('/api/rules', async (req, res) => {
  const { name, description, isActive, targetType, conditions } = req.body;

  if (!name || !targetType || !conditions) {
    return res.status(400).json({ error: 'Missing required parameters: name, targetType, conditions.' });
  }

  try {
    const stringifiedConditions = typeof conditions === 'string' ? conditions : JSON.stringify(conditions);
    
    // Validate AST parses correctly
    JSON.parse(stringifiedConditions);

    const [newRule] = await db
      .insert(rules)
      .values({
        name,
        description: description || null,
        isActive: isActive !== false,
        targetType,
        conditions: stringifiedConditions,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    res.status(201).json({
      ...newRule,
      conditions: JSON.parse(newRule.conditions),
    });
  } catch (error: any) {
    logger.error(error, 'Failed to create compliance rule');
    res.status(500).json({ error: 'Failed to create rule.' });
  }
});

// PUT /api/rules/:id - Update an existing rule
app.put('/api/rules/:id', async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  if (isNaN(ruleId)) {
    return res.status(400).json({ error: 'Invalid rule ID.' });
  }

  const { name, description, isActive, targetType, conditions } = req.body;

  try {
    const updatePayload: any = { updatedAt: new Date() };
    if (name) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description;
    if (isActive !== undefined) updatePayload.isActive = isActive;
    if (targetType) updatePayload.targetType = targetType;
    if (conditions) {
      const strCond = typeof conditions === 'string' ? conditions : JSON.stringify(conditions);
      JSON.parse(strCond); // validate
      updatePayload.conditions = strCond;
    }

    const [updatedRule] = await db
      .update(rules)
      .set(updatePayload)
      .where(eq(rules.id, ruleId))
      .returning();

    if (!updatedRule) {
      return res.status(404).json({ error: 'Rule not found.' });
    }

    res.json({
      ...updatedRule,
      conditions: JSON.parse(updatedRule.conditions),
    });
  } catch (error: any) {
    logger.error(error, `Failed to update rule ID ${ruleId}`);
    res.status(500).json({ error: 'Failed to update rule.' });
  }
});

// DELETE /api/rules/:id - Delete a rule
app.delete('/api/rules/:id', async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  if (isNaN(ruleId)) {
    return res.status(400).json({ error: 'Invalid rule ID.' });
  }

  try {
    const [rule] = await db.select().from(rules).where(eq(rules.id, ruleId)).limit(1);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found.' });
    }

    await db.delete(rules).where(eq(rules.id, ruleId));
    res.json({ message: `Successfully deleted compliance rule: ${rule.name}` });
  } catch (error: any) {
    logger.error(error, `Failed to delete rule ID ${ruleId}`);
    res.status(500).json({ error: 'Failed to delete rule.' });
  }
});

// POST /api/rules/test - Simulate testing a rule AST against a media file
app.post('/api/rules/test', async (req, res) => {
  const { conditions, mediaItemId } = req.body;

  if (!conditions || !mediaItemId) {
    return res.status(400).json({ error: 'Missing parameters: conditions and mediaItemId.' });
  }

  try {
    const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1);
    if (!item) {
      return res.status(404).json({ error: 'Media file not found.' });
    }

    const audio = await db.select().from(audioTracks).where(eq(audioTracks.mediaItemId, mediaItemId));
    const subtitles = await db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaItemId, mediaItemId));

    const itemWithTracks = {
      ...item,
      audioTracks: audio,
      subtitleTracks: subtitles,
    };

    const result = evaluateRule(conditions, itemWithTracks);
    res.json(result);
  } catch (error: any) {
    logger.error(error, 'Error during rule AST simulation test');
    res.status(500).json({ error: 'Simulation audit test failed.' });
  }
});

// ----------------------------------------------------
// 3. MEDIA FILES API
// ----------------------------------------------------

// GET /api/media - Paginated search and multi-dimensional filter list of media items
app.get('/api/media', async (req, res) => {
  const { libraryId, status, search, failedOnly, videoQuality, limit, offset } = req.query;
  logger.debug({ query: req.query }, 'GET /api/media requested with filters');

  const limitNum = parseInt(limit as string, 10) || 50;
  const offsetNum = parseInt(offset as string, 10) || 0;

  try {
    // 1. Build dynamic SQL WHERE clause
    let whereClause = eq(mediaItems.status, (status as string) || 'active');
    logger.trace(`Resolved basic media search condition: status=${status || 'active'}`);

    if (libraryId) {
      whereClause = and(whereClause, eq(mediaItems.libraryId, parseInt(libraryId as string, 10)))!;
    }

    if (search) {
      whereClause = and(
        whereClause,
        or(
          like(mediaItems.title, `%${search}%`),
          like(mediaItems.fileName, `%${search}%`)
        )
      )!;
    }

    if (videoQuality) {
      const q = String(videoQuality).toUpperCase();
      if (q === '4K') {
        whereClause = and(
          whereClause,
          or(
            like(mediaItems.videoResolution, '3840%'),
            like(mediaItems.videoResolution, '4096%')
          )
        )!;
      } else if (q === '1080P') {
        whereClause = and(whereClause, like(mediaItems.videoResolution, '1920%'))!;
      } else if (q === '720P') {
        whereClause = and(whereClause, like(mediaItems.videoResolution, '1280%'))!;
      } else if (q === 'SD') {
        // SD is anything that's not 720p, 1080p, or 4K
        whereClause = and(
          whereClause,
          sql`video_resolution NOT LIKE '1280%'`,
          sql`video_resolution NOT LIKE '1920%'`,
          sql`video_resolution NOT LIKE '3840%'`,
          sql`video_resolution NOT LIKE '4096%'`
        )!;
      }
    }

    if (failedOnly === 'true') {
      const failingIdsSubquery = db
        .select({ id: auditResults.mediaItemId })
        .from(auditResults)
        .where(eq(auditResults.passed, false));

      whereClause = and(whereClause, inArray(mediaItems.id, failingIdsSubquery))!;
    }

    // 2. Fetch overall matching count
    const [countRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(whereClause);

    const total = countRes ? countRes.count : 0;

    // 3. Fetch paginated media items
    let items;
    if (limit === '-1' || limitNum === -1) {
      items = await db
        .select()
        .from(mediaItems)
        .where(whereClause);
    } else {
      items = await db
        .select()
        .from(mediaItems)
        .where(whereClause)
        .limit(limitNum)
        .offset(offsetNum);
    }

    if (items.length === 0) {
      return res.json({ total, limit: limitNum, offset: offsetNum, items: [] });
    }

    // 4. Fetch tracks and audits for these items in bulk
    const itemIds = items.map((i) => i.id);

    const allAudio = await db.select().from(audioTracks).where(inArray(audioTracks.mediaItemId, itemIds));
    const allSubs = await db.select().from(subtitleTracks).where(inArray(subtitleTracks.mediaItemId, itemIds));
    
    const allAudits = await db
      .select({
        mediaItemId: auditResults.mediaItemId,
        ruleId: auditResults.ruleId,
        ruleName: rules.name,
        passed: auditResults.passed,
        errorMessage: auditResults.errorMessage,
        auditedAt: auditResults.auditedAt,
      })
      .from(auditResults)
      .innerJoin(rules, eq(auditResults.ruleId, rules.id))
      .where(inArray(auditResults.mediaItemId, itemIds));

    // 5. Map bulk tracks and audits to their objects in memory
    const audioMap = new Map<number, any[]>();
    for (const track of allAudio) {
      if (!audioMap.has(track.mediaItemId)) audioMap.set(track.mediaItemId, []);
      audioMap.get(track.mediaItemId)!.push(track);
    }

    const subMap = new Map<number, any[]>();
    for (const track of allSubs) {
      if (!subMap.has(track.mediaItemId)) subMap.set(track.mediaItemId, []);
      subMap.get(track.mediaItemId)!.push(track);
    }

    const auditMap = new Map<number, any[]>();
    for (const audit of allAudits) {
      if (!auditMap.has(audit.mediaItemId)) auditMap.set(audit.mediaItemId, []);
      auditMap.get(audit.mediaItemId)!.push(audit);
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      audioTracks: audioMap.get(item.id) || [],
      subtitleTracks: subMap.get(item.id) || [],
      auditResults: auditMap.get(item.id) || [],
    }));

    res.json({
      total,
      limit: limitNum,
      offset: offsetNum,
      items: enrichedItems,
    });
  } catch (error: any) {
    logger.error(error, 'Failed to query media library items');
    res.status(500).json({ error: 'Failed to search media library.' });
  }
});

// GET /api/media/:id - Detailed tracks and drawer specs for a specific file
app.get('/api/media/:id', async (req, res) => {
  const mediaItemId = parseInt(req.params.id, 10);
  if (isNaN(mediaItemId)) {
    return res.status(400).json({ error: 'Invalid media item ID.' });
  }

  try {
    const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1);
    if (!item) {
      return res.status(404).json({ error: 'Media file not found.' });
    }

    const audio = await db.select().from(audioTracks).where(eq(audioTracks.mediaItemId, mediaItemId));
    const subtitles = await db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaItemId, mediaItemId));

    const audits = await db
      .select({
        ruleId: auditResults.ruleId,
        ruleName: rules.name,
        passed: auditResults.passed,
        errorMessage: auditResults.errorMessage,
        auditedAt: auditResults.auditedAt,
      })
      .from(auditResults)
      .innerJoin(rules, eq(auditResults.ruleId, rules.id))
      .where(eq(auditResults.mediaItemId, mediaItemId));

    res.json({
      ...item,
      audioTracks: audio,
      subtitleTracks: subtitles,
      auditResults: audits,
    });
  } catch (error: any) {
    logger.error(error, `Failed to fetch media details for ID ${mediaItemId}`);
    res.status(500).json({ error: 'Failed to fetch media details.' });
  }
});

// GET /api/media/:id/raw - Returns the raw JSON MediaInfo metadata dump
app.get('/api/media/:id/raw', async (req, res) => {
  const mediaItemId = parseInt(req.params.id, 10);
  if (isNaN(mediaItemId)) {
    return res.status(400).json({ error: 'Invalid media item ID.' });
  }

  try {
    const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).limit(1);
    if (!item) {
      return res.status(404).json({ error: 'Media file not found.' });
    }

    res.json(JSON.parse(item.rawMetadata));
  } catch (error: any) {
    logger.error(error, `Failed to parse raw metadata for ID ${mediaItemId}`);
    res.status(500).json({ error: 'Failed to fetch raw metadata.' });
  }
});

// ----------------------------------------------------
// 4. STATS & HEALTH METRICS API
// ----------------------------------------------------

// GET /api/stats/overview - Overall library statistics
app.get('/api/stats/overview', async (req, res) => {
  try {
    // a. Count movies vs episodes
    const [movieCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .innerJoin(libraries, eq(mediaItems.libraryId, libraries.id))
      .where(
        and(
          eq(mediaItems.status, 'active'),
          eq(libraries.type, 'movie')
        )
      );

    const [episodeCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .innerJoin(libraries, eq(mediaItems.libraryId, libraries.id))
      .where(
        and(
          eq(mediaItems.status, 'active'),
          eq(libraries.type, 'tv')
        )
      );

    const activeMovies = movieCountRes ? movieCountRes.count : 0;
    const activeEpisodes = episodeCountRes ? episodeCountRes.count : 0;

    // b. Calculate overall compliance health score
    const [totalAuditsRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditResults)
      .innerJoin(mediaItems, eq(auditResults.mediaItemId, mediaItems.id))
      .where(eq(mediaItems.status, 'active'));

    const [passedAuditsRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditResults)
      .innerJoin(mediaItems, eq(auditResults.mediaItemId, mediaItems.id))
      .where(
        and(
          eq(mediaItems.status, 'active'),
          eq(auditResults.passed, true)
        )
      );

    const totalAudits = totalAuditsRes ? totalAuditsRes.count : 0;
    const passedAudits = passedAuditsRes ? passedAuditsRes.count : 0;
    const complianceScore = totalAudits > 0 ? Math.round((passedAudits / totalAudits) * 100) : 100;

    // c. Fetch Video Quality distribution
    // We group by videoResolution mapping to '4K', '1080p', '720p', or 'SD'
    const resolutionRaw = await db
      .select({
        resolution: mediaItems.videoResolution,
        count: sql<number>`count(*)`
      })
      .from(mediaItems)
      .where(eq(mediaItems.status, 'active'))
      .groupBy(mediaItems.videoResolution);

    const qualityDist = { '4K': 0, '1080p': 0, '720p': 0, 'SD': 0 };
    for (const row of resolutionRaw) {
      if (!row.resolution) {
        qualityDist['SD'] += row.count;
        continue;
      }
      const res = row.resolution;
      if (res.startsWith('3840') || res.startsWith('4096')) {
        qualityDist['4K'] += row.count;
      } else if (res.startsWith('1920')) {
        qualityDist['1080p'] += row.count;
      } else if (res.startsWith('1280')) {
        qualityDist['720p'] += row.count;
      } else {
        qualityDist['SD'] += row.count;
      }
    }

    // d. Fetch Container distribution
    const containerRaw = await db
      .select({
        container: mediaItems.container,
        count: sql<number>`count(*)`
      })
      .from(mediaItems)
      .where(eq(mediaItems.status, 'active'))
      .groupBy(mediaItems.container);

    const containerDist: Record<string, number> = {};
    for (const row of containerRaw) {
      containerDist[row.container.toUpperCase()] = row.count;
    }

    // e. Fetch Codec distribution
    const codecRaw = await db
      .select({
        codec: mediaItems.videoCodec,
        count: sql<number>`count(*)`
      })
      .from(mediaItems)
      .where(eq(mediaItems.status, 'active'))
      .groupBy(mediaItems.videoCodec);

    const codecDist: Record<string, number> = {};
    for (const row of codecRaw) {
      const codeName = row.codec ? row.codec.toUpperCase() : 'UNKNOWN';
      codecDist[codeName] = (codecDist[codeName] || 0) + row.count;
    }

    // f. Fetch counts of recently removed items
    const [removedCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .where(eq(mediaItems.status, 'removed'));
    const totalRemoved = removedCountRes ? removedCountRes.count : 0;

    res.json({
      moviesCount: activeMovies,
      episodesCount: activeEpisodes,
      complianceScore,
      totalAudits,
      passedAudits,
      totalRemoved,
      qualityDistribution: qualityDist,
      containerDistribution: containerDist,
      codecDistribution: codecDist,
    });
  } catch (error: any) {
    logger.error(error, 'Failed to compile library health statistics overview');
    res.status(500).json({ error: 'Failed to fetch library stats.' });
  }
});

// Serve frontend static assets in production
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(publicPath)) {
    logger.info(`Serving frontend static production bundle from: ${publicPath}`);
    app.use(express.static(publicPath));
    app.get('*', (req, res, next) => {
      // API requests shouldn't fall back to frontend index.html
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(publicPath, 'index.html'));
    });
  } else {
    logger.warn(`Frontend static production path not found at: ${publicPath}`);
  }
}

// Trigger Boot initialization
startServer();
