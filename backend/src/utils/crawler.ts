import fs from 'fs';
import path from 'path';
import logger from './logger';

export interface CrawledFile {
  filePath: string;
  fileName: string;
  fileSize: number;
  mtimeMs: number;
}

const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.m4v',
  '.mov',
  '.webm',
  '.flv',
  '.wmv',
  '.ts',
]);

/**
 * Recursively walks a directory on the local filesystem or mounted NAS and gathers all video files.
 * Emits trace-level logs for deep diagnostic walks.
 *
 * @param dirPath Absolute path to walk.
 * @returns Array of crawled files with paths, sizes, and mtimes.
 */
export function crawlDirectory(dirPath: string): CrawledFile[] {
  const files: CrawledFile[] = [];

  function walk(currentPath: string) {
    logger.trace(`Walking directory: ${currentPath}`);
    let entries: fs.Dirent[] = [];
    
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error: any) {
      logger.error(`Crawler failed to read directory "${currentPath}": ${error.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          try {
            const stats = fs.statSync(fullPath);
            files.push({
              filePath: fullPath,
              fileName: entry.name,
              fileSize: stats.size,
              mtimeMs: stats.mtimeMs,
            });
            logger.trace(`Crawler discovered video file: ${fullPath} (${stats.size} bytes)`);
          } catch (error: any) {
            logger.warn(`Crawler failed to stat file "${fullPath}": ${error.message}`);
          }
        }
      }
    }
  }

  logger.debug(`Beginning recursive walk on library path: ${dirPath}`);
  
  if (!fs.existsSync(dirPath)) {
    logger.error(`Crawl target path does not exist: ${dirPath}`);
    return [];
  }

  walk(dirPath);
  logger.debug(`Completed walk for "${dirPath}". Total video files found: ${files.length}`);
  return files;
}
export default crawlDirectory;
