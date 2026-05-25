import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  path: text('path').notNull().unique(), // e.g., /media/movies
  type: text('type').notNull(), // 'movie' | 'tv'
  refreshInterval: integer('refresh_interval').default(3600), // Interval in seconds, defaults to 3600 (1 hour)
  isAutoRefreshEnabled: integer('is_auto_refresh_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 2. Media Items (Movies and Episodes)
export const mediaItems = sqliteTable('media_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull().unique(), // Absolute path on host/container
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(), // in bytes
  mtimeMs: integer('mtime_ms').notNull(), // for change detection
  status: text('status').notNull(), // 'active' | 'removed'
  scannedAt: integer('scanned_at', { mode: 'timestamp' }).notNull(),
  removedAt: integer('removed_at', { mode: 'timestamp' }), // Track history
  
  // Parsed general metadata
  title: text('title'), // Media Title (from metadata or filename)
  season: integer('season'), // TV Shows only
  episode: integer('episode'), // TV Shows only
  container: text('container').notNull(), // e.g. mkv, mp4
  
  // Parsed Video metadata
  videoResolution: text('video_resolution'), // e.g. 3840x2160, 1920x1080
  videoBitrate: integer('video_bitrate'), // in bps
  videoCodec: text('video_codec'), // e.g. HEVC, AVC, AV1
  videoColorDepth: integer('video_color_depth'), // e.g. 8, 10, 12
  videoHdrFormat: text('video_hdr_format'), // e.g. HDR10, Dolby Vision, SDR
  
  // Raw JSON dump for safety/futureproofing
  rawMetadata: text('raw_metadata').notNull(), 
  
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 3. Audio Tracks
export const audioTracks = sqliteTable('audio_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id')
    .notNull()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  trackIndex: integer('track_index').notNull(),
  language: text('language'), // ISO 639-2 or full name, e.g., 'eng', 'ger'
  format: text('format').notNull(), // e.g. 'DTS', 'Dolby TrueHD', 'AAC', 'AC-3'
  channels: integer('channels'), // e.g. 2, 6, 8
  bitrate: integer('bitrate'), // in bps
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isForced: integer('is_forced', { mode: 'boolean' }).notNull().default(false),
});

// 4. Subtitle Tracks
export const subtitleTracks = sqliteTable('subtitle_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id')
    .notNull()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  trackIndex: integer('track_index').notNull(),
  language: text('language'), // e.g. 'eng', 'ger'
  format: text('format').notNull(), // e.g. 'SRT', 'PGS', 'ASS', 'VobSub'
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isForced: integer('is_forced', { mode: 'boolean' }).notNull().default(false),
  isHearingImpaired: integer('is_hearing_impaired', { mode: 'boolean' }).notNull().default(false), // SDH
});

// 5. Compliance Rules
export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  targetType: text('target_type').notNull(), // 'movie' | 'tv' | 'all'
  conditions: text('conditions').notNull(), // JSON string representing the conditions AST
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 6. Audit Results (Compliance cache table with composite primary key)
export const auditResults = sqliteTable('audit_results', {
  mediaItemId: integer('media_item_id')
    .notNull()
    .references(() => mediaItems.id, { onDelete: 'cascade' }),
  ruleId: integer('rule_id')
    .notNull()
    .references(() => rules.id, { onDelete: 'cascade' }),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  errorMessage: text('error_message'), // Explains failure: e.g. "Missing German Audio track"
  auditedAt: integer('audited_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.mediaItemId, table.ruleId] }),
}));

// 7. Series Metadata (Maps series directory folders to a custom type: 'tv' or 'anime')
export const seriesMetadata = sqliteTable('series_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  seriesPath: text('series_path').notNull().unique(), // The series folder path
  seriesName: text('series_name').notNull(), // Series folder name
  type: text('type').notNull().default('tv'), // 'tv' | 'anime'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
