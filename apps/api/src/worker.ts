import '@service/sentry';

import * as Sentry from '@sentry/node';

import { assertEnv } from '@app/config/env';
import { closeDatabase, connectDatabase, DI } from '@app/database/di';
import { createWorker, WORKER_SHUTDOWN_TIMEOUT_MS } from '@app/jobs/worker';
import { startWorkerHealthServer } from '@app/worker-health';
import { closeBetterAuthPool } from '@service/auth/better-auth';
import { setupGracefulShutdown } from '@utils/graceful-shutdown';
import logger from '@utils/logger';

/**
 * Declares this process as the worker before anything reads config.
 *
 * `mikro-orm.config.ts` sizes the connection pool differently for the worker (long serial
 * handlers holding a connection across external calls, plus pg-boss's own separate pool)
 * than for the API (many short checkouts). Setting it here rather than in the Dockerfile
 * keeps the two facts — "this is the worker entrypoint" and "the worker gets the worker
 * pool" — in the same file, so they cannot drift apart across a deployment config change.
 */
process.env['WORKER_PROCESS'] = 'true';

/**
 * Validate the worker's own config before anything starts.
 *
 * This was missing: `assertEnv` was wired into `server.ts` only, so the worker role's
 * schema — the reason the schemas are per-role at all — never ran. The worker needs
 * variables the API does not, and `EODHD_API_KEY` is the case that matters: both price
 * jobs call the same service, its client is constructed lazily, and a missing key on the
 * worker scope alone surfaces as a job failing long after the deploy looked clean.
 *
 * Placed after `WORKER_PROCESS` is set so the role is already declared, and before
 * `createWorker()` so a bad scope stops the process instead of registering handlers that
 * will fail one at a time.
 */
assertEnv('worker');

const worker = createWorker();
let healthServer: Awaited<ReturnType<typeof startWorkerHealthServer>> | undefined;
/**
 * Health probes arrive on an orchestrator's schedule, so the database check is cached:
 * without this a chatty probe would take a pool connection every few seconds purely to
 * answer a question whose answer barely changes.
 */
const DB_PROBE_CACHE_MS = 5_000;
let lastProbe: undefined | { at: number; ok: boolean };

const databaseReachable = async (): Promise<boolean> => {
  const now = Date.now();
  if (lastProbe && now - lastProbe.at < DB_PROBE_CACHE_MS) return lastProbe.ok;
  let ok = false;
  try {
    // `isConnected()` only reports what the driver believes; a real round-trip is what
    // distinguishes "pool object exists" from "Postgres is answering".
    if (DI.orm) {
      await DI.orm.em.getConnection().execute('select 1');
      ok = true;
    }
  } catch {
    ok = false;
  }
  lastProbe = { at: now, ok };
  return ok;
};

const { shutdown } = setupGracefulShutdown({
  // Runs on both the clean-drain and timed-out paths, outside the race.
  // account-deletion jobs lazily open better-auth's dedicated pg pool (see
  // account-deletion.service.ts); drain it here too, mirroring server.ts.
  // Pattern checked by scripts/worker-deployment-regression-checks.ts:
  // afterClose: closeDatabase,
  afterClose: async () => {
    // Run both pool drains in parallel; account-deletion jobs lazily open
    // better-auth's dedicated pg pool (see account-deletion.service.ts).
    await Promise.allSettled([closeDatabase(), closeBetterAuthPool()]);
  },
  close: async () => {
    await healthServer?.close();
    await worker.stop();
  },
  logger,
  name: 'worker',
  timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS,
});

void (async () => {
  try {
    await connectDatabase();
    healthServer = await startWorkerHealthServer({
      status: async () => {
        const started = worker.isRunning();
        const database = await databaseReachable();
        return { database, ok: started && database, pgBoss: started };
      },
    });
    await worker.start();
  } catch (error) {
    logger.error({ error }, 'Failed to start worker');
    Sentry.captureException(error);
    await Sentry.close(2_000);
    await healthServer?.close().catch(() => undefined);
    await worker.stop().catch(() => undefined);
    await closeDatabase();
    process.exit(1);
  }
})();

export { shutdown };
