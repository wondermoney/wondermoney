import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { Appuser } from './Appuser';
import { Base } from './BaseEntity';

/* eslint-disable perfectionist/sort-classes, perfectionist/sort-modules */

export enum BankSyncResult {
  FAILURE = 'failure',
  PARTIAL = 'partial',
  PENDING = 'pending',
  SUCCESS = 'success',
}

/**
 * Whether the incident has reached a terminal state. A bank terminal failure is
 * an initial-add incident that is exhausted or non-retryable; partial is not
 * success (metric-definitions §1 item 8).
 */
export enum BankSyncFinality {
  NON_TERMINAL = 'non_terminal',
  TERMINAL_FAILURE = 'terminal_failure',
  TERMINAL_SUCCESS = 'terminal_success',
}

/** Rollout mode observed on the terminal attempt (legacy audit semantics). */
export enum BankSyncRolloutMode {
  INTERNAL_ALLOWLIST = 'internal-allowlist',
  LIVE = 'live',
  OFF = 'off',
}

export enum BankSyncFlow {
  INITIAL_ADD = 'initial-add',
  SCHEDULED_REFRESH = 'scheduled-refresh',
}

export enum BankSyncProducer {
  INITIAL = 'pgboss-initial',
  SCHEDULED = 'pgboss-scheduled',
}

export enum BankSyncEnvironment {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  STAGING = 'staging',
}

/**
 * Durable initial-add bank-sync incident. Recovery-email delivery is keyed to
 * the incident-specific terminal state (a generic later `account_sync_succeeded`
 * must NOT cancel it). Deduplicated per (incident, recovery template version).
 *
 * IMPORTANT: stores only SAFE error fields (`errorCategory`/`errorCode`). Never
 * store the raw provider error or any email/PII here.
 */
@Check({ expression: `"rollout_mode" in ('dry_run', 'internal-allowlist', 'live', 'off')`, name: 'bank_sync_incident_rollout_mode_check' })
@Check({ expression: `("recovery_treatment_mode_snapshot" is null and "recovery_treatment_mode_captured_at" is null) or ("recovery_treatment_mode_snapshot" is not null and "recovery_treatment_mode_captured_at" is not null)`, name: 'bank_sync_incident_recovery_treatment_snapshot_check' })
@Entity({ tableName: 'bank_sync_incident' })
@Unique({ properties: ['incidentId', 'recoveryTemplateVersion'] })
export class BankSyncIncident extends Base {
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  @Property({ default: 0 })
  attempts!: number;

  @PrimaryKey()
  bankSyncIncidentKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  claimedAt?: Date;

  @Property({ nullable: true })
  @Unique()
  correlationId?: string;

  @Property({ columnType: 'uuid', nullable: true })
  distinctId?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  eligibleAfter?: Date;

  @Property({ nullable: true })
  errorCategory?: string;

  @Property({ nullable: true })
  errorCode?: string;

  @Enum({ items: () => BankSyncEnvironment, nullable: true })
  environment?: BankSyncEnvironment;

  @Enum(() => BankSyncFinality)
  finality: BankSyncFinality = BankSyncFinality.NON_TERMINAL;

  @Enum({ items: () => BankSyncFlow, nullable: true })
  flow?: BankSyncFlow;

  @Property({ nullable: true })
  institutionId?: string;

  @Property()
  @Unique()
  incidentId!: string;

  @Enum({ items: () => BankSyncProducer, nullable: true })
  producer?: BankSyncProducer;

  @Property({ nullable: true })
  recoveryTemplateVersion?: string;

  /** DB time at which the first failed/partial attempt froze recovery treatment. */
  @Property({ columnType: 'timestamptz', nullable: true })
  recoveryTreatmentModeCapturedAt?: Date;

  /** Recovery enrollment snapshot from the first failed/partial attempt. */
  @Enum({ items: () => BankSyncRolloutMode, nullable: true })
  recoveryTreatmentModeSnapshot?: BankSyncRolloutMode;

  @Property({ nullable: true })
  requisitionId?: string;

  @Enum(() => BankSyncResult)
  result!: BankSyncResult;

  @Property({ columnType: 'text' })
  rolloutMode!: BankSyncRolloutMode;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  successAt?: Date;

  @Property({ nullable: true })
  userVisible?: boolean;
}

/* eslint-enable perfectionist/sort-classes, perfectionist/sort-modules */
