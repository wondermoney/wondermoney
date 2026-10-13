import type { PgBossLike } from '@service/queue/pgboss-client';

export const BACKGROUND_OPERATION_RECOVERY_QUEUE = 'background-operation.recovery';
export const BACKGROUND_OPERATION_RECOVERY_CRON = '*/15 * * * *';
export const BACKGROUND_OPERATION_RECOVERY_SINGLETON_KEY = BACKGROUND_OPERATION_RECOVERY_QUEUE;

export const ensureBackgroundOperationRecoveryQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(BACKGROUND_OPERATION_RECOVERY_QUEUE, {
    // Runs every 15 minutes; a run outliving its own cadence is a problem, not a long job.
    expireInSeconds: 600,
    policy: 'singleton',
    retryBackoff: true,
    retryDelay: 60,
    retryLimit: 1,
  });

export const scheduleBackgroundOperationRecoveryJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(BACKGROUND_OPERATION_RECOVERY_QUEUE, BACKGROUND_OPERATION_RECOVERY_CRON, {}, {
    key: BACKGROUND_OPERATION_RECOVERY_SINGLETON_KEY,
    singletonKey: BACKGROUND_OPERATION_RECOVERY_SINGLETON_KEY,
    tz: 'UTC',
  });
