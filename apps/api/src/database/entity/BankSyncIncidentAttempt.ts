import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { BankSyncIncident } from './BankSyncIncident';
import { Base } from './BaseEntity';

export enum BankSyncAttemptResult {
  FAILED = 'failed',
  FULL_SUCCESS = 'full_success',
  PARTIAL = 'partial',
}

/** Append-only execution evidence. Completed rows must never be rewritten. */
@Entity({ tableName: 'bank_sync_incident_attempt' })
@Unique({ properties: ['incidentKey', 'attempt'] })
@Unique({ properties: ['incidentKey', 'queueJobId', 'queueAttempt'] })
export class BankSyncIncidentAttempt extends Base {
  @Property({ nullable: true })
  accountCount?: number;

  @Property()
  attempt!: number;

  @PrimaryKey()
  bankSyncIncidentAttemptKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Property({ default: 'bank-sync.v1' })
  contractVersion = 'bank-sync.v1';

  @Property({ nullable: true })
  errorCategory?: string;

  @Property({ nullable: true })
  errorCode?: string;

  @Property({ nullable: true })
  @Unique()
  eventId?: string;

  @Property({ default: false })
  final = false;

  @ManyToOne({ cascade: [], entity: () => BankSyncIncident, fieldName: 'bank_sync_incident_key' })
  incidentKey!: Rel<BankSyncIncident>;

  @Property({ nullable: true })
  institutionId?: string;

  @Property()
  queueAttempt!: number;

  @Property()
  queueJobId!: string;

  @Property({ columnType: 'varchar(80)', length: 80 })
  requisitionContext!: string;

  @Enum({ items: () => BankSyncAttemptResult, nullable: true })
  result?: BankSyncAttemptResult;

  @Property({ columnType: 'timestamptz' })
  startedAt!: Date;
}
