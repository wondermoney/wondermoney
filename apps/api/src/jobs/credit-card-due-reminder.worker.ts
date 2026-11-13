import type { EntityManager } from '@mikro-orm/postgresql';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { creditCardDueReminderDays } from '@app/jobs/credit-card-due-reminder.queue';
import { createCreditCardDueReminderEmailChannel } from '@service/account/credit-card-due-reminder-email.channel';
import { createCreditCardDueReminderPushChannel } from '@service/account/credit-card-due-reminder-push.channel';
import { type CreditCardDueReminderChannels, sendCreditCardDueReminders } from '@service/account/credit-card-due-reminder.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

/**
 * The daily payment-due reminder sweep. The work is idempotent per statement and channel, so a
 * retried job sends nothing twice; the reminder goes out only while the statement is closed,
 * unpaid and due within the configured number of days. A provider refusal that may clear leaves
 * its delivery pending and fails the job, so pg-boss retries the sweep and only that delivery
 * goes out again.
 */
export async function handleCreditCardDueReminderJob(deps: {
  channels?: CreditCardDueReminderChannels;
  daysBeforeDue?: number;
  em?: EntityManager;
  /** The push channel's queue; without one, reminders go by email only. */
  enqueue?: Enqueue;
  logger?: Pick<Logger, 'info'>;
  now?: Date;
} = {}) {
  const em = deps.em ?? DI.em;
  const { enqueue } = deps;
  const result = await sendCreditCardDueReminders({
    channels: deps.channels ?? {
      email: createCreditCardDueReminderEmailChannel(),
      push: createCreditCardDueReminderPushChannel({
        em,
        enabled: enqueue ? undefined : () => false,
        enqueue: () => {
          if (!enqueue) throw new Error('No queue for push reminders');
          return enqueue;
        },
      }),
    },
    daysBeforeDue: deps.daysBeforeDue ?? creditCardDueReminderDays(),
    em,
    now: deps.now ?? new Date(),
  });
  (deps.logger ?? logger).info({ ...result, queue: 'credit-card-due-reminder.sweep' }, 'Credit card due reminder sweep finished');
  if (result.retryable > 0) throw new Error(`Credit card due reminder sweep left ${result.retryable} deliveries to retry`);
  return result;
}
