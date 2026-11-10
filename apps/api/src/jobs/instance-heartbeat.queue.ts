import type { PgBossLike } from '@service/queue/pgboss-client';

/**
 * A no-op job the scheduler runs every five minutes. Its only output is the completed row pg-boss
 * keeps for it: `GET /v1/health/ready` reads the latest `completed_on` to tell whether the worker
 * is still pulling and finishing jobs. It needs nothing outside Postgres, so it works on every
 * install, unlike the external dead-man's switch in `worker-heartbeat.queue.ts`.
 *
 * Renaming the queue blinds the readiness check until the first run under the new name.
 */
export const INSTANCE_HEARTBEAT_QUEUE = 'instance.heartbeat';
export const INSTANCE_HEARTBEAT_CRON = '*/5 * * * *';
const INSTANCE_HEARTBEAT_SINGLETON_KEY = INSTANCE_HEARTBEAT_QUEUE;

export const ensureInstanceHeartbeatQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(INSTANCE_HEARTBEAT_QUEUE, {
    // Only the latest completion matters; a day of rows is plenty to look back on.
    deleteAfterSeconds: 86_400,
    expireInSeconds: 60,
    // The next tick supersedes a missed one, so a failed run is not retried.
    policy: 'singleton',
    retryLimit: 0,
  });

export const scheduleInstanceHeartbeatJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(INSTANCE_HEARTBEAT_QUEUE, INSTANCE_HEARTBEAT_CRON, {}, {
    key: INSTANCE_HEARTBEAT_SINGLETON_KEY,
    singletonKey: INSTANCE_HEARTBEAT_SINGLETON_KEY,
    tz: 'UTC',
  });

/**
 * One run right away, so a freshly started stack reports a live worker within seconds rather than
 * at the next five-minute mark.
 */
export const sendInstanceHeartbeatNow = (boss: Pick<PgBossLike, 'send'>) =>
  boss.send(INSTANCE_HEARTBEAT_QUEUE, {}, { singletonKey: INSTANCE_HEARTBEAT_SINGLETON_KEY });
