import type { PgBossLike } from '@service/queue/pgboss-client';

/** The daily pass that finds statements due in a few days and sends their reminder. */
export const CREDIT_CARD_DUE_REMINDER_QUEUE = 'credit-card-due-reminder.sweep';
/** 09:00 UTC: morning in Europe, after the night's scheduled syncs. */
export const CREDIT_CARD_DUE_REMINDER_CRON = '0 9 * * *';

/** How many days before the due date a reminder goes out, unless `CREDIT_CARD_DUE_REMINDER_DAYS` says otherwise. */
export const CREDIT_CARD_DUE_REMINDER_DAYS_DEFAULT = 3;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The reminder lead time in days. `CREDIT_CARD_DUE_REMINDER_DAYS` is validated at boot
 * (`config/configuration.ts`); this reader keeps a malformed value from turning into `NaN` days and
 * silently sending nothing.
 */
export function creditCardDueReminderDays(env: Env = process.env): number {
  const raw = env['CREDIT_CARD_DUE_REMINDER_DAYS']?.trim();
  if (!raw) return CREDIT_CARD_DUE_REMINDER_DAYS_DEFAULT;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : CREDIT_CARD_DUE_REMINDER_DAYS_DEFAULT;
}

export const ensureCreditCardDueReminderQueue = (boss: Pick<PgBossLike, 'createQueue'>) =>
  // The sweep is idempotent (a delivery is unique per statement and channel), so a retry after a
  // database blip is safe and keeps a day's reminders from being skipped.
  boss.createQueue(CREDIT_CARD_DUE_REMINDER_QUEUE, { expireInSeconds: 1_800, policy: 'exclusive', retentionSeconds: 1_209_600, retryBackoff: true, retryDelay: 300, retryLimit: 2 });

export const scheduleCreditCardDueReminderJob = (boss: Pick<PgBossLike, 'schedule'>) =>
  boss.schedule(CREDIT_CARD_DUE_REMINDER_QUEUE, CREDIT_CARD_DUE_REMINDER_CRON, {}, {
    key: CREDIT_CARD_DUE_REMINDER_QUEUE,
    singletonKey: CREDIT_CARD_DUE_REMINDER_QUEUE,
    tz: 'UTC',
  });
