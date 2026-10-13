import { Check, Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';

import { LifecycleCampaign, LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';

import { Appuser, SupportedLanguages } from './Appuser';
import { Base } from './BaseEntity';

/**
 * Generic per-user lifecycle email delivery. One row per (user, campaign, step),
 * mirroring the (since removed) trial-lifecycle delivery state machine (claim tokens, idempotency,
 * status transitions) but campaign-agnostic so every lifecycle track reuses it.
 * `step` is a plain string column (values differ per campaign — e.g. ActivationStep).
 */
@Check({ expression: `"provider_attempt_count" between 0 and 2`, name: 'lifecycle_delivery_provider_attempt_count_check' })
@Check({ expression: `"deleted_at" is null`, name: 'lifecycle_delivery_never_soft_delete_check' })
@Check({ expression: `("status" = 'pending' and "claim_token" is null and "claim_job_id" is null and "claimed_at" is null and "claim_expires_at" is null and "sent_at" is null and "completed_at" is null) or ("status" = 'claimed' and "claim_token" is not null and "claim_job_id" is not null and "claimed_at" is not null and "claim_expires_at" is not null and "sent_at" is null) or ("status" = 'sent' and "sent_at" is not null and "completed_at" is not null and "provider_message_id" is not null and "language_at_send" is not null) or ("status" in ('suppressed', 'failed') and "sent_at" is null and "completed_at" is not null and "outcome_code" is not null) or ("status" = 'needs_reconciliation' and "completed_at" is not null)`, name: 'lifecycle_delivery_status_fields_check' })
@Entity({ tableName: 'lifecycle_delivery' })
@Index({ name: 'lifecycle_delivery_due_pending_idx', properties: ['status', 'scheduledFor'] })
@Index({ name: 'lifecycle_delivery_stale_claimed_idx', properties: ['status', 'claimExpiresAt'] })
@Unique({ name: 'lifecycle_delivery_user_campaign_step_unique', properties: ['appuserKey', 'campaign', 'step'] })
/* eslint-disable perfectionist/sort-classes */
export class LifecycleDelivery extends Base {
  @ManyToOne({ cascade: [], deleteRule: 'no action', entity: () => Appuser, fieldName: 'appuser_key', foreignKeyName: 'lifecycle_delivery_appuser_foreign' }) appuserKey!: Rel<Appuser>;
  @Enum(() => LifecycleCampaign) campaign!: LifecycleCampaign;
  @Property({ length: 64 }) step!: string;
  @Property({ length: 64 }) templateVersion!: string;
  @Property({ columnType: 'timestamptz' }) scheduledFor!: Date;
  @Enum(() => LifecycleDeliveryStatus) status: LifecycleDeliveryStatus = LifecycleDeliveryStatus.PENDING;
  @Property({ default: 0 }) providerAttemptCount = 0;
  @Property({ columnType: 'uuid', nullable: true }) claimToken?: string;
  @Property({ nullable: true }) claimJobId?: string;
  @Property({ columnType: 'timestamptz', nullable: true }) claimedAt?: Date;
  @Property({ columnType: 'timestamptz', nullable: true }) claimExpiresAt?: Date;
  @Enum({ items: () => SupportedLanguages, nullable: true }) languageAtSend?: SupportedLanguages;
  @Property({ length: 255, nullable: true }) providerMessageId?: string;
  @Property({ columnType: 'timestamptz', nullable: true }) sentAt?: Date;
  @Property({ columnType: 'timestamptz', nullable: true }) completedAt?: Date;
  @Property({ length: 128, nullable: true }) outcomeCode?: string;
  @PrimaryKey() lifecycleDeliveryKey!: number;
}
/* eslint-enable perfectionist/sort-classes */
