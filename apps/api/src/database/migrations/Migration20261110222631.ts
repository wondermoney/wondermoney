import { Migration } from '@mikro-orm/migrations';

/**
 * Drops `lifecycle_delivery`, the per-user record of the retired lifecycle emails. Nothing has
 * read or written it since #152/#194 removed the campaigns, so the table and its history go.
 * Destructive: self-hosters must take a database backup before upgrading.
 */
export class Migration20261110222631 extends Migration {

  override name = 'Migration20261110222631';

  override up(): void | Promise<void> {
    this.addSql(`drop table if exists "lifecycle_delivery" cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`create table "lifecycle_delivery" ("appuser_key" int not null, "campaign" text not null, "claim_expires_at" timestamptz(6) null, "claim_job_id" varchar(255) null, "claim_token" uuid null, "claimed_at" timestamptz(6) null, "completed_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "language_at_send" text null, "lifecycle_delivery_key" serial primary key, "outcome_code" varchar(128) null, "provider_attempt_count" int not null default 0, "provider_message_id" varchar(255) null, "scheduled_for" timestamptz(6) not null, "sent_at" timestamptz(6) null, "status" text not null default 'pending', "step" varchar(64) not null, "template_version" varchar(64) not null, "updated_at" timestamptz(6) not null);`);
    this.addSql(`create index "lifecycle_delivery_due_pending_idx" on "lifecycle_delivery" ("status", "scheduled_for");`);
    this.addSql(`create index "lifecycle_delivery_stale_claimed_idx" on "lifecycle_delivery" ("status", "claim_expires_at");`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_user_campaign_step_unique" unique ("appuser_key", "campaign", "step");`);

    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_appuser_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_campaign_check" check ("campaign" in ('activation', 'data_health', 'engagement', 'reactivation'));`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_language_at_send_check" check ("language_at_send" in ('EN', 'PT'));`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_never_soft_delete_check" check ("deleted_at" is null);`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_provider_attempt_count_check" check ("provider_attempt_count" between 0 and 2);`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_status_check" check ("status" in ('claimed', 'failed', 'needs_reconciliation', 'pending', 'sent', 'suppressed'));`);
    this.addSql(`alter table "lifecycle_delivery" add constraint "lifecycle_delivery_status_fields_check" check (("status" = 'pending' and "claim_token" is null and "claim_job_id" is null and "claimed_at" is null and "claim_expires_at" is null and "sent_at" is null and "completed_at" is null) or ("status" = 'claimed' and "claim_token" is not null and "claim_job_id" is not null and "claimed_at" is not null and "claim_expires_at" is not null and "sent_at" is null) or ("status" = 'sent' and "sent_at" is not null and "completed_at" is not null and "provider_message_id" is not null and "language_at_send" is not null) or ("status" in ('suppressed', 'failed') and "sent_at" is null and "completed_at" is not null and "outcome_code" is not null) or ("status" = 'needs_reconciliation' and "completed_at" is not null));`);
  }

}
