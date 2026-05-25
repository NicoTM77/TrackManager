import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Prioritize root .env in development using absolute file resolution (immune to process.cwd drifts)
const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../../.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, override: true });
} else if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv, override: true });
} else {
  dotenv.config({ override: true });
}

import pino from 'pino';

// Define threshold from environment or default to 'info'
const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

// Determine if we should use colorized terminal output (development) or structured JSON (production/test)
const isDevelopment = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

// Configure Pino instance
export const logger = pino({
  level: logLevel,
  // Pino naturally handles TRACE, DEBUG, INFO, WARN, ERROR logs.
  // In production/test, it outputs single-line structured JSON synchronously.
  // In development, it uses pino-pretty for clean, human-readable terminal lines.
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export default logger;
