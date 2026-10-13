import logger from '@utils/logger';

/**
 * Runs a background task without letting a rejection become an unhandled
 * promise rejection, which crashes the process (see graceful-shutdown.ts).
 * Use for genuinely best-effort work (e.g. transactional emails) where a
 * failure should be logged, not propagated to the caller.
 */
export function fireAndForget(promise: Promise<unknown>, context: Record<string, unknown> = {}): void {
  // Promise.resolve() also tolerates a non-promise value (e.g. an unmocked
  // test double returning undefined) so this helper itself never throws.
  Promise.resolve(promise).catch((error: unknown) => {
    logger.error({ error, ...context }, 'Unhandled rejection in fire-and-forget task');
  });
}
