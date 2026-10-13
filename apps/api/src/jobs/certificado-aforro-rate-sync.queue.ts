export const CERTIFICADO_AFORRO_RATE_SYNC_QUEUE = 'certificado-aforro.rate-sync';

/**
 * Daily at 05:00 UTC. IGCP publishes the next month's rate near the end of the current month,
 * but the exact publish day drifts, so we poll daily rather than guessing a date: the upsert is
 * idempotent and a not-yet-published month is a cheap soft no-op (a single 404'd HTTP GET).
 */
export const CERTIFICADO_AFORRO_RATE_SYNC_CRON = '0 5 * * *';

/**
 * Sentry Cron Monitor slug. Stable by contract — renaming it silently orphans the
 * existing monitor and starts a fresh one with no history. See `cron-monitor.ts`.
 */
export const CERTIFICADO_AFORRO_RATE_SYNC_MONITOR_SLUG = 'certificado-aforro-rate-sync';

export const ensureCertificadoAforroRateSyncQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(CERTIFICADO_AFORRO_RATE_SYNC_QUEUE, {
  // IGCP page fetch + PDF download + Azure vision OCR. Explicit because the vision SDK's
  // own default is 600 s per attempt, which the 900 s pg-boss default does not survive.
  expireInSeconds: 1_800,
  policy: 'exclusive',
  retryLimit: 0,
});

export const scheduleCertificadoAforroRateSyncAutoJob = (boss: {
  schedule: (
    name: string,
    cron: string,
    data?: null | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}) =>
  boss.schedule(CERTIFICADO_AFORRO_RATE_SYNC_QUEUE, CERTIFICADO_AFORRO_RATE_SYNC_CRON, {}, {
    key: CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
    singletonKey: CERTIFICADO_AFORRO_RATE_SYNC_QUEUE,
    tz: 'UTC',
  });
