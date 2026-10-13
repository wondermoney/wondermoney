import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-178 growth measurement data model (Task 3).
 *
 * Additive, DDL-only migration: creates the 12 durable growth tables. It does
 * not alter or drop any pre-existing table and contains no data writes
 * (migrations are schema-only in this repository).
 *
 * NOTE: the generator also emitted a large unrelated diff (pre-existing drift
 * between entity metadata and the replayed migration chain: partial indexes,
 * check-constraint orderings, FK cascade options). That drift predates this
 * change and was intentionally stripped so this migration stays additive-only.
 */
export class Migration20260719090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "analytics_outbox" ("analytics_outbox_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "distinct_id" varchar(255) not null, "event_name" varchar(255) not null, "event_id" varchar(255) not null, "properties" jsonb not null, "sent_at" timestamptz null);`);
    this.addSql(`alter table "analytics_outbox" add constraint "analytics_outbox_event_id_unique" unique ("event_id");`);

    this.addSql(`create table "attribution_envelope_nonce" ("attribution_envelope_nonce_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "consumed_at" timestamptz null, "expires_at" timestamptz not null, "nonce" varchar(255) not null);`);
    this.addSql(`alter table "attribution_envelope_nonce" add constraint "attribution_envelope_nonce_nonce_unique" unique ("nonce");`);

    this.addSql(`create table "measurement_cohort" ("measurement_cohort_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "description" text null, "name" varchar(255) not null, "release_commit_sha" varchar(255) null, "release_manifest_ref" varchar(255) null, "starts_at" timestamptz not null);`);
    this.addSql(`alter table "measurement_cohort" add constraint "measurement_cohort_name_unique" unique ("name");`);

    this.addSql(`create table "growth_milestone" ("growth_milestone_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "achieved_at" timestamptz not null, "appuser_key" int not null, "milestone" text check ("milestone" in ('checkout', 'first_value', 'post_payment')) not null, "version" varchar(255) not null);`);
    this.addSql(`alter table "growth_milestone" add constraint "growth_milestone_appuser_key_milestone_version_unique" unique ("appuser_key", "milestone", "version");`);

    this.addSql(`create table "growth_activity_fact" ("growth_activity_fact_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "activity_type" varchar(255) not null, "appuser_key" int not null, "occurred_at" timestamptz not null, "utc_day" date not null);`);
    this.addSql(`alter table "growth_activity_fact" add constraint "growth_activity_fact_appuser_key_utc_day_activity_type_unique" unique ("appuser_key", "utc_day", "activity_type");`);

    this.addSql(`create table "consent_ledger_entry" ("consent_ledger_entry_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "action" text check ("action" in ('grant', 'withdraw')) not null, "appuser_key" int not null, "policy_version" varchar(255) not null, "purpose" text check ("purpose" in ('ads', 'analytics', 'lifecycle_email')) not null, "recorded_at" timestamptz not null);`);

    this.addSql(`create table "consent_effective_state" ("consent_effective_state_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "decided_at" timestamptz not null, "granted" boolean not null, "policy_version" varchar(255) not null, "purpose" text check ("purpose" in ('ads', 'analytics', 'lifecycle_email')) not null);`);
    this.addSql(`alter table "consent_effective_state" add constraint "consent_effective_state_appuser_key_purpose_unique" unique ("appuser_key", "purpose");`);

    this.addSql(`create table "bank_sync_incident" ("bank_sync_incident_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "attempts" int not null default 0, "claimed_at" timestamptz null, "correlation_id" varchar(255) null, "eligible_after" timestamptz null, "error_category" varchar(255) null, "error_code" varchar(255) null, "finality" text check ("finality" in ('non_terminal', 'terminal_failure', 'terminal_success')) not null default 'non_terminal', "incident_id" varchar(255) not null, "recovery_template_version" varchar(255) null, "result" text check ("result" in ('failure', 'partial', 'pending', 'success')) not null, "rollout_mode" text check ("rollout_mode" in ('dry_run', 'live', 'off')) not null, "sent_at" timestamptz null, "success_at" timestamptz null);`);
    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_incident_id_unique" unique ("incident_id");`);
    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_incident_id_recovery_template_version_unique" unique ("incident_id", "recovery_template_version");`);

    this.addSql(`create table "appuser_classification" ("appuser_classification_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "classification" text check ("classification" in ('internal', 'real', 'test', 'unknown')) not null default 'unknown', "classified_at" timestamptz not null, "reason" text null, "source" text check ("source" in ('allowlist', 'automated', 'manual', 'signup')) not null);`);
    this.addSql(`alter table "appuser_classification" add constraint "appuser_classification_appuser_key_unique" unique ("appuser_key");`);

    this.addSql(`create table "signup_snapshot" ("signup_snapshot_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "attribution" jsonb not null, "appuser_key" int not null, "analytics_distinct_id" varchar(255) not null, "classification" text check ("classification" in ('internal', 'real', 'test', 'unknown')) not null default 'unknown', "completed_at" timestamptz not null, "offer_version" varchar(255) not null, "trial_days" int not null);`);
    this.addSql(`alter table "signup_snapshot" add constraint "signup_snapshot_appuser_key_unique" unique ("appuser_key");`);

    this.addSql(`create table "stripe_event_fact" ("stripe_event_fact_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "amount" numeric null, "appuser_key" int null, "coupon_id" varchar(255) null, "currency" varchar(3) null, "event_type" varchar(255) not null, "livemode" boolean not null, "occurred_at" timestamptz not null, "payer_qualification" text check ("payer_qualification" in ('exceptional_discount', 'founder', 'friend', 'none', 'team')) not null default 'none', "price_id" varchar(255) null, "promotion_code_id" varchar(255) null, "provider_event_id" varchar(255) not null, "signup_snapshot_key" int null);`);
    this.addSql(`alter table "stripe_event_fact" add constraint "stripe_event_fact_provider_event_id_unique" unique ("provider_event_id");`);

    this.addSql(`create table "trial_lifecycle_enrollment" ("trial_lifecycle_enrollment_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "enrolled_at" timestamptz not null, "status" text check ("status" in ('cancelled', 'completed', 'enrolled')) not null default 'enrolled', "subscription_key" int not null, "template_version" varchar(255) not null, "treatment_at" timestamptz not null, "trial_end_at" timestamptz not null, "trial_start_at" timestamptz not null);`);
    this.addSql(`alter table "trial_lifecycle_enrollment" add constraint "trial_lifecycle_enrollment_subscription_key_unique" unique ("subscription_key");`);

    this.addSql(`alter table "growth_milestone" add constraint "growth_milestone_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "growth_activity_fact" add constraint "growth_activity_fact_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "consent_ledger_entry" add constraint "consent_ledger_entry_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "consent_effective_state" add constraint "consent_effective_state_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);

    this.addSql(`alter table "appuser_classification" add constraint "appuser_classification_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on update cascade;`);

    this.addSql(`alter table "signup_snapshot" add constraint "signup_snapshot_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on update cascade;`);

    this.addSql(`alter table "stripe_event_fact" add constraint "stripe_event_fact_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "stripe_event_fact" add constraint "stripe_event_fact_signup_snapshot_key_foreign" foreign key ("signup_snapshot_key") references "signup_snapshot" ("signup_snapshot_key") on delete set null;`);

    this.addSql(`alter table "trial_lifecycle_enrollment" add constraint "trial_lifecycle_enrollment_subscription_key_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "stripe_event_fact" drop constraint "stripe_event_fact_signup_snapshot_key_foreign";`);

    this.addSql(`drop table if exists "analytics_outbox" cascade;`);

    this.addSql(`drop table if exists "attribution_envelope_nonce" cascade;`);

    this.addSql(`drop table if exists "measurement_cohort" cascade;`);

    this.addSql(`drop table if exists "growth_milestone" cascade;`);

    this.addSql(`drop table if exists "growth_activity_fact" cascade;`);

    this.addSql(`drop table if exists "consent_ledger_entry" cascade;`);

    this.addSql(`drop table if exists "consent_effective_state" cascade;`);

    this.addSql(`drop table if exists "bank_sync_incident" cascade;`);

    this.addSql(`drop table if exists "appuser_classification" cascade;`);

    this.addSql(`drop table if exists "signup_snapshot" cascade;`);

    this.addSql(`drop table if exists "stripe_event_fact" cascade;`);

    this.addSql(`drop table if exists "trial_lifecycle_enrollment" cascade;`);
  }

}
