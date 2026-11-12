import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { CreditCardDueReminderChannel, CreditCardDueReminderDelivery, CreditCardDueReminderStatus } from '@entity/CreditCardDueReminderDelivery';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import logger from '@utils/logger';

import { statementsBetween, utcDayNumber } from './credit-card-cycle';
import { getCreditCardStatements } from './credit-card-statement.service';

/**
 * Payment-due reminders for credit cards.
 *
 * A daily sweep looks for card statements that closed with a balance still to pay and are due
 * within `daysBeforeDue` days (three by default), the due day included. Each statement is reminded
 * about at most once per channel: the `credit_card_due_reminder_delivery` row is the dedupe, keyed
 * by the card, the statement's close day and the channel, so a later sweep finds the row and sends
 * nothing. Reading "within" rather than "exactly N days out" lets the next day's sweep catch up
 * after a missed run, and still reminds about a statement that closes fewer than N days before it
 * is due.
 *
 * **Days are UTC calendar days**, as everywhere in the statement cycle (`credit-card-cycle.ts`).
 * The sweep runs at 09:00 UTC, when the UTC date is the local date from UTC-9 to UTC+14, so "due in
 * three days" reads the same wherever the owner is.
 *
 * **Recipient.** The reminder goes to the card's owner — the member the account belongs to — and
 * only while they are still an active member of the card's household: a member who left keeps no
 * view of the household's cards, so they get no reminder about one either. A private card is
 * visible only to its owner, who is the only person reminded.
 *
 * The channel seam mirrors `services/bank-sync-alerts`: email is the only channel today, and
 * mobile push joins the list with its own gate once push delivery exists. A channel that is not
 * `available` (email with no provider configured) is skipped without recording anything, so the
 * reminder still goes out once it is configured.
 */

const MS_PER_DAY = 86_400_000;
/** The UTC day number of a `YYYY-MM-DD` calendar day. */
const calendarDayNumber = (day: string) => utcDayNumber(new Date(`${day}T00:00:00.000Z`));
/** How far either side of today the statement window is read. A due date is at most ~a month out. */
const WINDOW_DAYS = 40;

/** The channels a reminder goes out on. Push joins this list once mobile push exists. */
export const CREDIT_CARD_DUE_REMINDER_CHANNELS: readonly CreditCardDueReminderChannel[] = [CreditCardDueReminderChannel.EMAIL];

export interface CreditCardDueReminderChannelHandler {
  /** Whether the channel can deliver at all on this instance (email: a provider is configured). */
  available(): boolean;
  deliver(message: CreditCardDueReminderMessage): Promise<CreditCardDueReminderChannelOutcome>;
  /** Why this recipient must not get it on this channel (written to the delivery as its outcome), or undefined to send. */
  gate(recipient: Appuser, preference: EmailNotificationPreference | null): string | undefined;
}

export type CreditCardDueReminderChannelOutcome =
  /** The provider took it. */
  | { providerMessageId?: string; type: 'delivered' }
  /** Refused for good; do not try again. */
  | { code: string; type: 'failed' }
  /** Refused before acceptance for a reason that may clear; try again later. */
  | { code: string; type: 'retryable' }
  /** No answer: it may have been delivered, so it is never tried again. */
  | { code: string; type: 'unknown' };

export type CreditCardDueReminderChannels = Record<CreditCardDueReminderChannel, CreditCardDueReminderChannelHandler>;

export interface CreditCardDueReminderMessage {
  accountKey: number;
  /** The account's name, or null when the person never named it. */
  accountName: null | string;
  /** What is still to pay on the statement, as a positive figure in the card's currency. */
  amountDue: number;
  currencyCode: string;
  /** Calendar days from today to the due date: 0 is due today. */
  daysUntilDue: number;
  /** The due date as a calendar day, `YYYY-MM-DD`. */
  dueDate: string;
  periodEnd: string;
  periodStart: string;
  recipient: Appuser;
}

export interface SendCreditCardDueRemindersInput {
  channels: CreditCardDueReminderChannels;
  daysBeforeDue: number;
  em: EntityManager;
  now: Date;
}

export interface SendCreditCardDueRemindersResult {
  /** Statements that matched the reminder window and had a delivery to make. */
  reminded: number;
  /** Deliveries left pending after a refusal that may clear; the job retries them. */
  retryable: number;
  /** Deliveries the provider took. */
  sent: number;
}

export async function sendCreditCardDueReminders(input: SendCreditCardDueRemindersInput): Promise<SendCreditCardDueRemindersResult> {
  const result: SendCreditCardDueRemindersResult = { reminded: 0, retryable: 0, sent: 0 };
  const channels = CREDIT_CARD_DUE_REMINDER_CHANNELS.filter((channel) => input.channels[channel].available());
  if (channels.length === 0) return result;

  const todayDay = utcDayNumber(input.now);
  const lastDueDay = todayDay + input.daysBeforeDue;
  // The worker has no tenant context, so the read spans every household; each card is scoped to
  // its own account and owner below.
  const cards = await input.em.find(
    CreditCardDetail,
    { accountKey: { deletedAt: null }, deletedAt: null },
    { populate: ['accountKey', 'accountKey.accountOwnerAppuserKey', 'accountKey.currencyKey'] },
  );

  for (const card of cards) {
    const account = card.accountKey;
    const owner = account.accountOwnerAppuserKey;
    if (!owner || owner.deletedAt) continue;
    const cycle = { paymentDueDay: card.paymentDueDay, statementCloseDay: card.statementCloseDay };
    // The cycle alone says whether any statement is in the window; only then are its rows read.
    const inWindow = (dueDay: number, closeDay: number) => closeDay < todayDay && dueDay >= todayDay && dueDay <= lastDueDay;
    const candidates = statementsBetween(cycle, new Date(input.now.getTime() - WINDOW_DAYS * MS_PER_DAY), input.now);
    if (!candidates.some((period) => inWindow(utcDayNumber(period.dueDate), utcDayNumber(period.periodEnd)))) continue;

    const statements = await getCreditCardStatements(input.em, {
      accountKey: account.accountKey,
      creditLimit: card.creditLimit,
      cycle,
      from: new Date(input.now.getTime() - WINDOW_DAYS * MS_PER_DAY),
      to: input.now,
      today: input.now,
    });
    // Closed and still owing, due between today and the lead time. An open statement is still
    // counting charges, so its balance is not final; a paid one has nothing to remind; an overdue
    // one is past the point a reminder helps.
    const due = statements.filter((statement) => statement.status === 'closed'
      && statement.balance > 0
      && inWindow(calendarDayNumber(statement.dueDate), calendarDayNumber(statement.periodEnd)));
    if (due.length === 0) continue;

    const member = await input.em.count(AppuserTenant, { appuserKey: owner, deletedAt: null, recordActive: true, tenantKey: account.tenantKey });
    if (member === 0) continue;
    const preference = await input.em.findOne(EmailNotificationPreference, { appuserKey: owner, deletedAt: null });

    for (const statement of due) {
      result.reminded += 1;
      for (const channel of channels) {
        const outcome = await deliverOnChannel(input, input.channels[channel], {
          accountKey: account.accountKey,
          accountName: account.accountName ?? null,
          amountDue: statement.balance,
          currencyCode: account.currencyKey.code,
          daysUntilDue: calendarDayNumber(statement.dueDate) - todayDay,
          dueDate: statement.dueDate,
          periodEnd: statement.periodEnd,
          periodStart: statement.periodStart,
          recipient: owner,
        }, channel, preference);
        if (outcome === 'sent') result.sent += 1;
        if (outcome === 'retryable') result.retryable += 1;
      }
    }
  }
  return result;
}

/** Claims, gates and sends one statement's reminder on one channel, recording the outcome. */
async function deliverOnChannel(
  input: SendCreditCardDueRemindersInput,
  handler: CreditCardDueReminderChannelHandler,
  message: CreditCardDueReminderMessage,
  channel: CreditCardDueReminderChannel,
  preference: EmailNotificationPreference | null,
): Promise<'retryable' | 'sent' | undefined> {
  const delivery = await claimDelivery(input.em, { accountKey: message.accountKey, channel, now: input.now, periodEnd: message.periodEnd });
  // Another sweep already recorded this delivery, whatever its outcome.
  if (!delivery) return undefined;

  const blocked = handler.gate(message.recipient, preference);
  if (blocked) {
    await finishDelivery(input.em, delivery, CreditCardDueReminderStatus.SUPPRESSED, blocked, input.now);
    return undefined;
  }

  let outcome: CreditCardDueReminderChannelOutcome;
  try {
    outcome = await handler.deliver(message);
  } catch (error) {
    logger.warn({ accountKey: message.accountKey, error, periodEnd: message.periodEnd }, 'Credit card due reminder channel threw');
    // A throw after the provider call started may still have delivered it.
    outcome = { code: 'channel_error', type: 'unknown' };
  }

  switch (outcome.type) {
    case 'delivered':
      await finishDelivery(input.em, delivery, CreditCardDueReminderStatus.SENT, 'sent', input.now, outcome.providerMessageId);
      return 'sent';
    case 'failed':
      await finishDelivery(input.em, delivery, CreditCardDueReminderStatus.FAILED, outcome.code, input.now);
      return undefined;
    case 'retryable':
      // Left pending: the job's retry (or the next day's sweep, while the statement is still in
      // the window) claims it again.
      await finishDelivery(input.em, delivery, CreditCardDueReminderStatus.PENDING, outcome.code, input.now);
      return 'retryable';
    case 'unknown':
      await finishDelivery(input.em, delivery, CreditCardDueReminderStatus.UNKNOWN, outcome.code, input.now);
      return undefined;
  }
}

/** Records the delivery if this is the first sweep to see it; null when one already exists. */
async function claimDelivery(em: EntityManager, input: { accountKey: number; channel: CreditCardDueReminderChannel; now: Date; periodEnd: string }): Promise<CreditCardDueReminderDelivery | null> {
  const inserted = await em.getConnection().execute<{ creditCardDueReminderDeliveryKey: number }[]>(
    `insert into "credit_card_due_reminder_delivery" ("account_key", "period_end", "channel", "status", "created_at", "updated_at")
     values (?, ?, ?, ?, ?, ?)
     on conflict ("account_key", "period_end", "channel") do update
       set "status" = excluded."status", "outcome_code" = null, "completed_at" = null, "updated_at" = excluded."updated_at"
       where "credit_card_due_reminder_delivery"."status" = ?
     returning "credit_card_due_reminder_delivery_key" as "creditCardDueReminderDeliveryKey"`,
    [input.accountKey, input.periodEnd, input.channel, CreditCardDueReminderStatus.PROCESSING, input.now, input.now, CreditCardDueReminderStatus.PENDING],
  );
  const key = inserted[0]?.creditCardDueReminderDeliveryKey;
  if (!key) return null;
  return em.findOne(CreditCardDueReminderDelivery, { creditCardDueReminderDeliveryKey: key });
}

async function finishDelivery(
  em: EntityManager,
  delivery: CreditCardDueReminderDelivery,
  status: CreditCardDueReminderStatus,
  outcomeCode: string,
  now: Date,
  providerMessageId?: string,
): Promise<void> {
  em.assign(delivery, {
    completedAt: status === CreditCardDueReminderStatus.PENDING ? undefined : now,
    outcomeCode,
    providerMessageId,
    sentAt: status === CreditCardDueReminderStatus.SENT ? now : undefined,
    status,
  });
  await em.flush();
}
