import type { PgBossLike } from '@service/queue/pgboss-client';

export const WORKER_HEARTBEAT_QUEUE = 'worker.heartbeat';
// Every 2 minutes: comfortably inside the HetrixTools monitor's 5-minute timeout
// + 3-minute grace, so a single missed tick never trips a false DOWN alert.
export const WORKER_HEARTBEAT_CRON = '*/2 * * * *';
export const WORKER_HEARTBEAT_SINGLETON_KEY = WORKER_HEARTBEAT_QUEUE;

export const ensureWorkerHeartbeatQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(WORKER_HEARTBEAT_QUEUE, {
    // A 10 s HTTP ping. Anything past a minute is a stuck job holding the slot that the
    // whole dead-man's switch depends on.
    expireInSeconds: 60,
    // A heartbeat is only meaningful for the current moment; retrying a stale
    // ping is pointless because the next scheduled tick supersedes it.
    policy: 'singleton',
    retryLimit: 0,
  });

export const scheduleWorkerHeartbeatJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(WORKER_HEARTBEAT_QUEUE, WORKER_HEARTBEAT_CRON, {}, {
    key: WORKER_HEARTBEAT_SINGLETON_KEY,
    singletonKey: WORKER_HEARTBEAT_SINGLETON_KEY,
    tz: 'UTC',
  });

export const unscheduleWorkerHeartbeatJob = (boss: Pick<PgBossLike, 'unschedule'>) =>
  boss.unschedule(WORKER_HEARTBEAT_QUEUE);
