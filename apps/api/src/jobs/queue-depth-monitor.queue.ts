import type { PgBossLike } from '@service/queue/pgboss-client';

export const QUEUE_DEPTH_MONITOR_QUEUE = 'queue-depth.monitor';
export const QUEUE_DEPTH_MONITOR_CRON = '*/5 * * * *';
export const QUEUE_DEPTH_MONITOR_SINGLETON_KEY = 'queue-depth.monitor.v1';
/**
 * Renaming this slug starts a brand-new Sentry monitor with no history, which is
 * exactly the wrong thing for the one check that guards every other check.
 */
export const QUEUE_DEPTH_MONITOR_MONITOR_SLUG = 'queue-depth-monitor';

export const ensureQueueDepthMonitorQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(QUEUE_DEPTH_MONITOR_QUEUE, {
    // Read-only aggregate over pgboss.job; a stuck one is worthless five minutes
    // later, so expire fast and let the next tick supersede it.
    expireInSeconds: 120,
    policy: 'singleton',
    retentionSeconds: 172_800,
    retryLimit: 1,
  });

export const scheduleQueueDepthMonitorJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(QUEUE_DEPTH_MONITOR_QUEUE, QUEUE_DEPTH_MONITOR_CRON, {}, {
    key: QUEUE_DEPTH_MONITOR_SINGLETON_KEY,
    singletonKey: QUEUE_DEPTH_MONITOR_SINGLETON_KEY,
    tz: 'UTC',
  });
