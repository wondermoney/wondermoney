import type { Logger } from 'pino';

interface GracefulShutdownOptions {
  /**
   * Cleanup that MUST run whether `close()` drained cleanly or hit the timeout — closing
   * the database connection pool, principally.
   *
   * It exists because putting that work inside `close()` made it conditional on winning a
   * race it was designed to lose: the outer timeout rejecting meant `close()` never
   * returned, so the `finally` that closed the pool was abandoned and the process exited
   * 1 with its Postgres connections left to the server's own cleanup. Anything here runs
   * outside the race, on both paths, with its own short budget.
   */
  afterClose?: () => Promise<void>;
  /** Budget for the after-close cleanup. Kept small: it is spent after the drain budget. */
  afterCloseTimeoutMs?: number;
  close: () => Promise<void>;
  logger: Pick<Logger, 'error' | 'info' | 'warn'>;
  name: string;
  timeoutMs?: number;
}

type ShutdownReason = 'uncaughtException' | 'unhandledRejection' | NodeJS.Signals;

const withTimeout = async (label: string, run: () => Promise<void>, timeoutMs: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(`${label} timed out after ${timeoutMs}ms`)); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export function setupGracefulShutdown({ afterClose, afterCloseTimeoutMs = 3_000, close, logger, name, timeoutMs = 30_000 }: GracefulShutdownOptions) {
  let shutdownPromise: null | Promise<void> = null;

  const exit = (code: number) => process.exit(code);

  const startShutdown = (reason: ShutdownReason, error?: unknown) => {
    if (!shutdownPromise) {
      logger.info({ reason, timeoutMs }, `Received ${name} shutdown signal`);
      let failed = false;
      shutdownPromise = withTimeout(`${name} shutdown`, close, timeoutMs)
        .catch((shutdownError) => {
          failed = true;
          logger.error({ error: shutdownError, reason, shutdownCause: error }, `Failed during ${name} shutdown`);
        })
        // Always runs — that is the entire point of this hook.
        .then(async () => {
          if (!afterClose) return;
          try {
            await withTimeout(`${name} post-shutdown cleanup`, afterClose, afterCloseTimeoutMs);
          } catch (cleanupError) {
            failed = true;
            logger.error({ error: cleanupError, reason }, `Failed during ${name} post-shutdown cleanup`);
          }
        })
        .then(() => {
          if (failed) { exit(1); return; }
          const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
          exit(exitCode);
        });
    } else if (error) {
      logger.error({ error, reason }, `${name} shutdown already in progress`);
    }

    return shutdownPromise;
  };

  const onUnhandledRejection = (reason: unknown) => {
    process.exitCode = 1;
    logger.error({ error: reason }, `Unhandled rejection in ${name}`);
    void startShutdown('unhandledRejection', reason);
  };

  const onUncaughtException = (error: unknown) => {
    process.exitCode = 1;
    logger.error({ error }, `Uncaught exception in ${name}`);
    void startShutdown('uncaughtException', error);
  };

  process.once('SIGTERM', () => void startShutdown('SIGTERM'));
  process.once('SIGINT', () => void startShutdown('SIGINT'));
  process.once('unhandledRejection', onUnhandledRejection);
  process.once('uncaughtException', onUncaughtException);

  return { shutdown: startShutdown };
}
