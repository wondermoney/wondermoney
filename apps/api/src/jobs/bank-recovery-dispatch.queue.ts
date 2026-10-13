import type { PgBossLike } from '@service/queue/pgboss-client';

export const BANK_RECOVERY_DISPATCH_QUEUE = 'bank-recovery.dispatch';
export const BANK_RECOVERY_DISPATCH_CRON = '*/5 * * * *';
export const BANK_RECOVERY_DISPATCH_SINGLETON_KEY = BANK_RECOVERY_DISPATCH_QUEUE;

export const ensureBankRecoveryDispatchQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  boss.createQueue(BANK_RECOVERY_DISPATCH_QUEUE, { expireInSeconds: 600, policy: 'exclusive' });

/**
 * Deliberately exported-but-uncalled: `BANK_RECOVERY_MODE` defaults to `off` and the
 * feature ships fail-closed, enabled "only through an approved release manifest". The
 * worker for this queue *is* registered (`jobs/worker.ts`), so the dispatch path is live
 * — only the schedule that feeds it is withheld. Deleting this would mean rebuilding it
 * to turn the feature on, so it stays. Flagged as unused by `knip`; that is expected.
 */
export const scheduleBankRecoveryDispatchJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(BANK_RECOVERY_DISPATCH_QUEUE, BANK_RECOVERY_DISPATCH_CRON, {}, {
    key: BANK_RECOVERY_DISPATCH_SINGLETON_KEY,
    singletonKey: BANK_RECOVERY_DISPATCH_SINGLETON_KEY,
    tz: 'UTC',
  });

// Tears down a schedule registered by a prior deploy — pg-boss requires an explicit unschedule
// call, deleting the schedule row doesn't happen just by no longer calling `schedule(...)`.
export const unscheduleBankRecoveryDispatchJob = (boss: Pick<PgBossLike, 'unschedule'>) =>
  boss.unschedule(BANK_RECOVERY_DISPATCH_QUEUE, BANK_RECOVERY_DISPATCH_SINGLETON_KEY);
