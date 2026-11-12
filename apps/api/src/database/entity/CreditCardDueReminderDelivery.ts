import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Account } from './Account';
import { Base } from './BaseEntity';

export enum CreditCardDueReminderChannel {
  EMAIL = 'email',
}

export enum CreditCardDueReminderStatus {
  /** The provider rejected it for good. */
  FAILED = 'failed',
  PENDING = 'pending',
  /** A worker owns the provider attempt; a concurrent/retried sweep cannot claim it. */
  PROCESSING = 'processing',
  SENT = 'sent',
  /** Not sent: the statement was paid, or the recipient turned reminders off or cannot receive them. */
  SUPPRESSED = 'suppressed',
  /** The provider call ended without an answer; it may have been delivered, so it is not retried. */
  UNKNOWN = 'unknown',
}

/**
 * One payment-due reminder for one statement on one channel
 * (`services/account/credit-card-due-reminder.service.ts`). The unique key is the dedupe: a
 * statement is reminded about at most once per channel, however many daily sweeps see it. The row
 * holds no address or rendered content.
 *
 * A statement is named by its close day (`periodEnd`), which is unique per card. The reminder goes
 * to the card's owner, the member the account belongs to.
 */
@Entity({ tableName: 'credit_card_due_reminder_delivery' })
@Index({ name: 'credit_card_due_reminder_delivery_status_idx', properties: ['status'] })
@Unique({ name: 'credit_card_due_reminder_delivery_statement_unique', properties: ['accountKey', 'periodEnd', 'channel'] })
export class CreditCardDueReminderDelivery extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Account, fieldName: 'account_key' })
  accountKey!: Rel<Account>;

  @Enum(() => CreditCardDueReminderChannel)
  channel!: CreditCardDueReminderChannel;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  @PrimaryKey()
  creditCardDueReminderDeliveryKey!: number;

  @Property({ length: 64, nullable: true })
  outcomeCode?: string;

  /** The statement's close day: the day that names the statement. */
  @Property({ columnType: 'date' })
  periodEnd!: Date;

  @Property({ length: 255, nullable: true })
  providerMessageId?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Enum(() => CreditCardDueReminderStatus)
  status: CreditCardDueReminderStatus = CreditCardDueReminderStatus.PENDING;
}
