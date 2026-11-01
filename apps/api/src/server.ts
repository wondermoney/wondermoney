import { assertEnv } from '@app/config/env';
import { closeBetterAuthPool } from '@service/auth/better-auth';
import { setupGracefulShutdown } from '@utils/graceful-shutdown';
import logger from '@utils/logger';

import Application from './app';
import { closeDatabase } from './database/di';

const startServer = async () => {
  // Fail fast, loudly, and with every problem listed at once. Otherwise a missing required
  // secret degrades silently — e.g. a missing auth secret could produce an API that boots
  // cleanly, serves traffic, and fails to validate credentials correctly.
  assertEnv('api');

  const application = new Application();
  await application.connect();
  await application.init();

  setupGracefulShutdown({
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          application.server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } finally {
        await Promise.allSettled([closeDatabase(), closeBetterAuthPool()]);
      }
    },
    logger,
    name: 'api',
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  throw err;
});
