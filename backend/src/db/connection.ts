import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';

// Database path defaults to local.db in backend root (for development)
// In Docker, DATABASE_URL should be set to /app/data/local.db
// In Vitest tests (NODE_ENV=test), we force an in-memory SQLite database to ensure clean, isolated runs
const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : (process.env.DATABASE_URL || 'local.db');

// Ensure the parent directory of the database exists
const dbDir = path.dirname(dbPath);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  logger.info(`Created database directory: ${dbDir}`);
}

logger.debug(`Connecting SQLite database at: ${dbPath}`);
let sqlite = new Database(dbPath);

// Enable WAL mode (Write-Ahead Logging) for superior concurrent read/write performance
sqlite.pragma('journal_mode = WAL');
// Enable SQLite foreign keys cascade and validation support
sqlite.pragma('foreign_keys = ON');

export let db = drizzle(sqlite, { schema });

/**
 * Reconnects the database to a fresh SQLite instance, useful for test isolation.
 */
export function reconnectDatabase(customPath?: string) {
  const targetPath = customPath || dbPath;
  logger.debug(`Reconnecting SQLite database to fresh instance: ${targetPath}`);
  try {
    sqlite.close();
  } catch (e) {}
  sqlite = new Database(targetPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
}

/**
 * Runs Drizzle migrations on startup to ensure the SQLite schema is always up-to-date.
 */
export async function initializeDatabase() {
  logger.info(`Initializing database tables for path: ${dbPath}`);
  
  try {
    // Migrations are stored in backend/drizzle folder
    // __dirname in src/db is backend/src/db -> '../../drizzle' goes to backend/drizzle
    // In compiled dist/db, going '../../drizzle' will check backend/dist/../drizzle -> backend/drizzle
    const migrationsPath = path.resolve(__dirname, '../../drizzle');
    logger.debug(`Locating migration artifacts in: ${migrationsPath}`);
    
    if (!fs.existsSync(migrationsPath)) {
      logger.warn(`Migrations folder not found at "${migrationsPath}". Auto-migrations will be skipped. Run 'npm run db:generate' first.`);
      return;
    }

    logger.debug('Applying migrations...');
    await migrate(db, { migrationsFolder: migrationsPath });
    logger.info('Database migrations applied successfully.');
  } catch (error) {
    logger.error(error, 'CRITICAL: Database initialization and schema migration failed');
    throw error;
  }
}
