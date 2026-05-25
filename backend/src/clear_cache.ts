import { db } from './db/connection';
import { mediaItems } from './db/schema';
import logger from './utils/logger';

async function run() {
  logger.info('Clearing cached media items to force a fresh re-scan of all subtitle tracks...');
  try {
    const deleted = db.delete(mediaItems).run();
    logger.info(`Successfully cleared ${deleted.changes} media items from cache.`);
    process.exit(0);
  } catch (err: any) {
    logger.error(err, 'Failed to clear media items cache');
    process.exit(1);
  }
}

run();
