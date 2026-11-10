import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { EnableBankingConnection } from './EnableBankingConnection';

export enum BankSyncAlertChannel {
  EMAIL = 'email',
}

export enum BankSyncAlertDeliveryStatus {
  /** The provider rejected it for good. */
  FAILED = 'failed',
  PENDING = 'pending',
  /** Claimed by a send job. A row left here by a crashed job is never sent again. */
  SENDING = 'sending',
  SENT = 'sent',
  /** Not sent: the alert no longer applied, or the recipient turned it off or cannot receive it. */
  SUPPRESSED = 'suppressed',
  /** The provider call ended without an answer; it may have been delivered, so it is not retried. */
  UNKNOWN = 'unknown',
}

export enum BankSyncAlertEventType {
  CONSENT_EXPIRING_1D = 'consent_expiring_1d',
  CONSENT_EXPIRING_7D = 'consent_expiring_7d',
  CONSENT_REVOKED = 'consent_revoked',
  SYNC_FAILING = 'sync_failing',
}

/**
 * One bank sync alert (`services/bank-sync-alerts/bank-sync-alert-policy.ts`) on one channel. The
 * unique key is the dedupe: an alert for a connection, event and episode goes out at most once per
 * channel, however many daily sweeps see it. The row holds no address or rendered content.
 */
@Entity({ tableName: 'bank_sync_alert_delivery' })
@Index({ name: 'bank_sync_alert_delivery_status_idx', properties: ['status'] })
@Unique({ name: 'bank_sync_alert_delivery_episode_unique', properties: ['enableBankingConnectionKey', 'event', 'episodeKey', 'channel'] })
export class BankSyncAlertDelivery extends Base {
  /** The connection's owner: the only member who can reconnect it, and the only one told about it. */
  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @PrimaryKey()
  bankSyncAlertDeliveryKey!: number;

  @Enum(() => BankSyncAlertChannel)
  channel!: BankSyncAlertChannel;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  @ManyToOne({ cascade: [], deleteRule: 'cascade', entity: () => EnableBankingConnection, fieldName: 'enable_banking_connection_key' })
  enableBankingConnectionKey!: Rel<EnableBankingConnection>;

  /** The consent's end date or the failure streak's start, as an ISO timestamp. */
  @Property({ length: 64 })
  episodeKey!: string;

  @Enum(() => BankSyncAlertEventType)
  event!: BankSyncAlertEventType;

  @Property({ length: 64, nullable: true })
  outcomeCode?: string;

  @Property({ length: 255, nullable: true })
  providerMessageId?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Enum(() => BankSyncAlertDeliveryStatus)
  status: BankSyncAlertDeliveryStatus = BankSyncAlertDeliveryStatus.PENDING;
}
