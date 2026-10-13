import { Migration } from '@mikro-orm/migrations';

/** Anonymous trial-expiry feedback responses. DDL only, with no identity columns. */
export class Migration20260719160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "anonymous_trial_expiry_feedback_response" ("anonymous_trial_expiry_feedback_response_key" uuid primary key, "reason" varchar(64) not null, "submitted_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`);
    this.addSql(`alter table "anonymous_trial_expiry_feedback_response" add constraint "anonymous_trial_expiry_feedback_response_reason_check" check ("reason" in ('too_expensive', 'missing_features', 'setup_or_connection_issues', 'not_enough_time', 'not_useful_enough', 'privacy_or_trust_concerns', 'other')), add constraint "anonymous_trial_expiry_feedback_response_never_soft_delete_check" check ("deleted_at" is null);`);
  }

  override async down(): Promise<void> { this.addSql(`drop table if exists "anonymous_trial_expiry_feedback_response" cascade;`); }
}
