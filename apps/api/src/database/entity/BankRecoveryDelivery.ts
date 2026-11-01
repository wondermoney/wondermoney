import type { Rel } from '@mikro-orm/core';
import { Check, Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { SupportedLanguages } from './Appuser';
import { BankSyncIncident } from './BankSyncIncident';
import { Base } from './BaseEntity';

export enum BankRecoveryAuthorizationBasis {
  LIFECYCLE_CONSENT = 'lifecycle_consent',
}

export enum BankRecoveryDeliveryStatus {
  CLAIMED = 'claimed',
  FAILED = 'failed',
  NEEDS_RECONCILIATION = 'needs_reconciliation',
  PENDING = 'pending',
  SENT = 'sent',
  SUPPRESSED = 'suppressed',
}

export enum BankRecoveryTreatmentMode {
  INTERNAL_ALLOWLIST = 'internal-allowlist',
  LIVE = 'live',
}

/**
 * Durable outbound intent. It intentionally contains no recipient, rendered
 * content, or raw provider payload. Terminal transitions are immutable through
 * the service API, and rows are never soft-deleted.
 */
@Check({ expression: `"outcome_code" <> 'provider_accepted_db_unknown' or ("status" = 'needs_reconciliation' and "provider_message_id" is not null and "language_at_send" is not null and "authorization_basis" = 'lifecycle_consent' and "consent_policy_version_at_send" is not null)`, name: 'bank_recovery_delivery_accepted_unknown_evidence_check' })
@Check({ expression: `"attempt_count" between 0 and 2`, name: 'bank_recovery_delivery_attempt_count_check' })
@Check({ expression: `"deleted_at" is null`, name: 'bank_recovery_delivery_never_soft_delete_check' })
@Check({ expression: `("status" = 'pending' and "claim_token" is null and "claim_job_id" is null and "claimed_at" is null and "claim_expires_at" is null and "completed_at" is null and "sent_at" is null) or ("status" = 'claimed' and "claim_token" is not null and "claim_job_id" is not null and "claimed_at" is not null and "claim_expires_at" is not null and "rollout_mode_at_claim" is not null and "completed_at" is null and "sent_at" is null) or ("status" = 'sent' and "claim_token" is not null and "sent_at" is not null and "completed_at" is not null and "language_at_send" is not null and "authorization_basis" = 'lifecycle_consent' and "consent_policy_version_at_send" is not null and "provider_message_id" is not null) or ("status" in ('suppressed', 'failed') and "sent_at" is null and "completed_at" is not null and "outcome_code" is not null) or ("status" = 'needs_reconciliation' and "outcome_code" <> 'provider_accepted_db_unknown' and "sent_at" is null and "completed_at" is not null and "outcome_code" is not null) or ("status" = 'needs_reconciliation' and "outcome_code" = 'provider_accepted_db_unknown' and "provider_message_id" is not null and "language_at_send" is not null and "authorization_basis" = 'lifecycle_consent' and "consent_policy_version_at_send" is not null and "sent_at" is null and "completed_at" is not null)`, name: 'bank_recovery_delivery_status_fields_check' })
@Entity({ tableName: 'bank_recovery_delivery' })
@Index({ name: 'bank_recovery_delivery_due_pending_idx', properties: ['status', 'eligibleAfter'] })
@Index({ name: 'bank_recovery_delivery_stale_claimed_idx', properties: ['status', 'claimExpiresAt'] })
@Unique({ name: 'bank_recovery_delivery_incident_template_unique', properties: ['incidentKey', 'templateVersion'] })
export class BankRecoveryDelivery extends Base {
  @Property({ default: 0 })
  attemptCount = 0;

  @Enum({ items: () => BankRecoveryAuthorizationBasis, nullable: true })
  authorizationBasis?: BankRecoveryAuthorizationBasis;

  @PrimaryKey()
  bankRecoveryDeliveryKey!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  claimedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  claimExpiresAt?: Date;

  @Property({ nullable: true })
  claimJobId?: string;

  @Property({ columnType: 'uuid', nullable: true })
  claimToken?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Property({ nullable: true })
  consentPolicyVersionAtSend?: string;

  @Property({ columnType: 'timestamptz' })
  eligibleAfter!: Date;

  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => BankSyncIncident, fieldName: 'bank_sync_incident_key' })
  incidentKey!: Rel<BankSyncIncident>;

  @Enum({ items: () => SupportedLanguages, nullable: true })
  languageAtSend?: SupportedLanguages;

  @Property({ length: 128, nullable: true })
  outcomeCode?: string;

  @Property({ length: 255, nullable: true })
  providerMessageId?: string;

  @Enum({ items: () => BankRecoveryTreatmentMode, nullable: true })
  rolloutModeAtClaim?: BankRecoveryTreatmentMode;

  @Property({ columnType: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Enum(() => BankRecoveryDeliveryStatus)
  status!: BankRecoveryDeliveryStatus;

  @Property({ length: 64 })
  templateVersion!: string;

  @Enum(() => BankRecoveryTreatmentMode)
  treatmentMode!: BankRecoveryTreatmentMode;
}
