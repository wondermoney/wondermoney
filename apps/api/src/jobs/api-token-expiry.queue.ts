export const API_TOKEN_EXPIRY_QUEUE = 'api-token.expiry-reminder';

/** Daily at 09:00 UTC: a reminder lands in the user's morning, seven days before expiry. */
export const API_TOKEN_EXPIRY_CRON = '0 9 * * *';

export const ensureApiTokenExpiryQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(API_TOKEN_EXPIRY_QUEUE, {
  expireInSeconds: 1_800,
  policy: 'exclusive',
  retryBackoff: true,
  retryDelay: 600,
  retryLimit: 3,
});

export const scheduleApiTokenExpiryJob = (boss: {
  schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.schedule(API_TOKEN_EXPIRY_QUEUE, API_TOKEN_EXPIRY_CRON, {}, {
    key: API_TOKEN_EXPIRY_QUEUE,
    singletonKey: API_TOKEN_EXPIRY_QUEUE,
    tz: 'UTC',
  });
