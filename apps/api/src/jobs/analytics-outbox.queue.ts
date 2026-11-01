import type { PgBossLike } from '@service/queue/pgboss-client';

export const ANALYTICS_OUTBOX_QUEUE = 'analytics.outbox';
export const ANALYTICS_OUTBOX_CRON = '* * * * *';
const ANALYTICS_OUTBOX_SINGLETON_KEY = ANALYTICS_OUTBOX_QUEUE;

export const ensureAnalyticsOutboxQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(ANALYTICS_OUTBOX_QUEUE, {
    // Runs every minute over a bounded SKIP LOCKED batch; a tick still running after
    // five minutes is wedged, not busy, and must not block the next one for 15.
    expireInSeconds: 300,
    policy: 'singleton',
    retryBackoff: true,
    retryDelay: 30,
    retryLimit: 3,
  });

export const scheduleAnalyticsOutboxJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(ANALYTICS_OUTBOX_QUEUE, ANALYTICS_OUTBOX_CRON, {}, {
    key: ANALYTICS_OUTBOX_SINGLETON_KEY,
    singletonKey: ANALYTICS_OUTBOX_SINGLETON_KEY,
    tz: 'UTC',
  });
