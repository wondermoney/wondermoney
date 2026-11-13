import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

/**
 * One person's notification switches. Despite the name it holds the push categories too, so every
 * notification preference lives in one row.
 */
@Entity({ tableName: 'email_notification_preference' })
export class EmailNotificationPreference extends Base {
  @Property({ default: true })
  accountRecoveryEnabled = true;

  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  @Unique({ name: 'email_notification_preference_appuser_key_unique' })
  appuserKey!: Rel<Appuser>;

  /** Bank connection alerts: consent ending, ended by the bank, or syncs failing (`services/bank-sync-alerts`). */
  @Property({ default: true })
  bankSyncAlertsEnabled = true;

  @Property({ default: true })
  budgetAlertsEnabled = true;

  /** Payment-due reminders for credit-card statements (`services/account/credit-card-due-reminder.service.ts`). */
  @Property({ default: true })
  creditCardDueRemindersEnabled = true;

  @PrimaryKey()
  emailNotificationPreferenceKey!: number;

  @Property({ default: true })
  growthEmailsEnabled = true;

  @Property({ default: true })
  monthlyStoryEnabled = true;

  /**
   * Push categories (`services/push`). Off unless the person turns them on in the mobile app, which
   * asks the phone for permission at that moment. Email and push are separate switches.
   */
  @Property({ default: false })
  pushBankSyncAlertsEnabled = false;

  @Property({ default: false })
  pushBudgetAlertsEnabled = false;

  @Property({ default: false })
  pushCreditCardDueRemindersEnabled = false;

  @Property({ default: true })
  weeklyInsightsEnabled = true;
}
