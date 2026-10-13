import { Migration } from '@mikro-orm/migrations';

/** Public PT trial-expiry feedback responses. DDL only. */
export class Migration20260719150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "trial_expiry_feedback_response" ("trial_expiry_feedback_response_key" serial primary key, "trial_lifecycle_delivery_key" int not null, "reason" varchar(64) not null, "submitted_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`);
    this.addSql(`alter table "trial_expiry_feedback_response" add constraint "trial_expiry_feedback_response_delivery_unique" unique ("trial_lifecycle_delivery_key"), add constraint "trial_expiry_feedback_response_delivery_foreign" foreign key ("trial_lifecycle_delivery_key") references "trial_lifecycle_delivery" ("trial_lifecycle_delivery_key") on delete no action, add constraint "trial_expiry_feedback_response_reason_check" check ("reason" in ('too_expensive', 'missing_features', 'setup_or_connection_issues', 'not_enough_time', 'not_useful_enough', 'privacy_or_trust_concerns', 'other')), add constraint "trial_expiry_feedback_response_never_soft_delete_check" check ("deleted_at" is null);`);
  }

  override async down(): Promise<void> { this.addSql(`drop table if exists "trial_expiry_feedback_response" cascade;`); }
}
