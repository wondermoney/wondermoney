export const PRIVACY_RETENTION_QUEUE = 'privacy.retention-purge';

/** Daily at 04:20 UTC, a quiet hour: deletes the personal data whose 30 days are up. */
export const PRIVACY_RETENTION_CRON = '20 4 * * *';

export const ensurePrivacyRetentionQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(PRIVACY_RETENTION_QUEUE, {
  expireInSeconds: 3_600,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 600,
  retryLimit: 3,
});

export const schedulePrivacyRetentionJob = (boss: {
  schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.schedule(PRIVACY_RETENTION_QUEUE, PRIVACY_RETENTION_CRON, {}, {
    key: PRIVACY_RETENTION_QUEUE,
    singletonKey: PRIVACY_RETENTION_QUEUE,
    tz: 'UTC',
  });
