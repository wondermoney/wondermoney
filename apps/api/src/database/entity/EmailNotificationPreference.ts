import type { Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

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

  @PrimaryKey()
  emailNotificationPreferenceKey!: number;

  @Property({ default: true })
  growthEmailsEnabled = true;

  @Property({ default: true })
  monthlyStoryEnabled = true;

  @Property({ default: true })
  weeklyInsightsEnabled = true;
}
