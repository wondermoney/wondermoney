import { Migration } from '@mikro-orm/migrations';

/**
 * Generic lifecycle_delivery table: one row per (appuser, campaign, step), the
 * reusable delivery state machine for the email lifecycle foundation. Mirrors
 * the trial_lifecycle_delivery shape minus the trial-specific columns
 * (enrollment/subscription FKs, consent, provider_message_uuid).
 */
export class Migration20260728000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "lifecycle_delivery" ("lifecycle_delivery_key" serial primary key, "appuser_key" int not null, "campaign" text not null check ("campaign" in ('activation')), "step" varchar(64) not null, "template_version" varchar(64) not null, "scheduled_for" timestamptz not null, "status" text not null default 'pending' check ("status" in ('pending', 'claimed', 'sent', 'suppressed', 'failed', 'needs_reconciliation')), "provider_attempt_count" int not null default 0, "claim_token" uuid null, "claim_job_id" varchar(255) null, "claimed_at" timestamptz null, "claim_expires_at" timestamptz null, "language_at_send" text check ("language_at_send" in ('EN', 'PT')) null, "provider_message_id" varchar(255) null, "sent_at" timestamptz null, "completed_at" timestamptz null, "outcome_code" varchar(128) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`);

    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_user_campaign_step_unique" unique ("appuser_key", "campaign", "step"), add constraint "lifecycle_delivery_appuser_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete no action;`);

    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_provider_attempt_count_check" check ("provider_attempt_count" between 0 and 2), add constraint "lifecycle_delivery_never_soft_delete_check" check ("deleted_at" is null);`);

    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_status_fields_check" check (("status" = 'pending' and "claim_token" is null and "claim_job_id" is null and "claimed_at" is null and "claim_expires_at" is null and "sent_at" is null and "completed_at" is null) or ("status" = 'claimed' and "claim_token" is not null and "claim_job_id" is not null and "claimed_at" is not null and "claim_expires_at" is not null and "sent_at" is null) or ("status" = 'sent' and "sent_at" is not null and "completed_at" is not null and "provider_message_id" is not null and "language_at_send" is not null) or ("status" in ('suppressed', 'failed') and "sent_at" is null and "completed_at" is not null and "outcome_code" is not null) or ("status" = 'needs_reconciliation' and "completed_at" is not null));`);

    this.addSql(`create index "lifecycle_delivery_due_pending_idx" on "lifecycle_delivery" ("status", "scheduled_for");`);
    this.addSql(`create index "lifecycle_delivery_stale_claimed_idx" on "lifecycle_delivery" ("status", "claim_expires_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "lifecycle_delivery" cascade;`);
  }
}
