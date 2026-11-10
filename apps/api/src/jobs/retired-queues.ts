import type { PgBossLike } from '@service/queue/pgboss-client';

/**
 * pg-boss queues and cron schedules of retired features: the paid product (trials, Stripe
 * card-expiry warnings, referral rewards, renewal-deferral campaigns) and the activation marketing
 * emails, removed when WonderMoney became free and self-hostable; and the generic lifecycle email
 * send path, whose last campaign (the 14-day consent-expiry reminder) was replaced by per-connection
 * bank sync alerts (`bank-sync-alert.*`).
 *
 * pg-boss keeps schedules and queued jobs in its own tables, so dropping the code does not stop
 * them: a schedule registered by an earlier deploy keeps creating jobs that no worker consumes.
 * The scheduler-owning worker calls this on every boot. Both operations are idempotent — `unschedule` is a plain
 * delete and `deleteQueue` ignores a queue that no longer exists — so a fresh self-hosted install,
 * which never had any of these, is unaffected.
 */
const RETIRED_SCHEDULES = [
  { key: 'card-expiry.warning', name: 'card-expiry.warning' },
  { key: 'referral-reward.sweep', name: 'referral-reward.sweep' },
  { key: 'trial-lifecycle.reconcile.v1', name: 'trial-lifecycle.reconcile' },
  { key: 'email.trial-check-ins', name: 'email.trial-check-ins' },
  { key: 'lifecycle.cron.v1', name: 'lifecycle.cron' },
] as const;

const RETIRED_QUEUES = [
  'campaign.renewal-deferral.reconcile',
  'campaign.renewal-deferral.send',
  'card-expiry.warning',
  'email.trial-check-ins',
  'referral-reminder.send',
  'referral-reward.sweep',
  'trial-lifecycle.reconcile',
  'trial-lifecycle.send',
  'activation-lifecycle.send',
  'lifecycle.send',
  'lifecycle.cron',
  // Dead-letter queues last, after the queues that pointed at them.
  'campaign.renewal-deferral.reconcile.dlq',
  'campaign.renewal-deferral.send.dlq',
  'activation-lifecycle.send.dlq',
  'lifecycle.send.dlq',
] as const;

export async function removeRetiredQueues(boss: Pick<PgBossLike, 'deleteQueue' | 'unschedule'>): Promise<void> {
  for (const { key, name } of RETIRED_SCHEDULES) await boss.unschedule(name, key);
  for (const name of RETIRED_QUEUES) await boss.deleteQueue(name);
}
