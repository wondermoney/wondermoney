import { Migration } from '@mikro-orm/migrations';

/** RAD-178 Task 13: additive, DDL-only bank-sync incident execution contract. */
export class Migration20260719090300 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "bank_sync_incident" add column "distinct_id" uuid null, add column "environment" text check ("environment" in ('production', 'staging', 'development')) null, add column "flow" text check ("flow" in ('initial-add', 'scheduled-refresh')) null, add column "institution_id" varchar(128) null, add column "producer" text check ("producer" in ('pgboss-initial', 'pgboss-scheduled')) null, add column "requisition_id" varchar(255) null;`);
    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_correlation_id_unique" unique ("correlation_id");`);
    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_producer_flow_check" check (("producer" = 'pgboss-initial' and "flow" = 'initial-add') or ("producer" = 'pgboss-scheduled' and "flow" = 'scheduled-refresh'));`);
    this.addSql(`alter table "bank_sync_incident" add constraint "bank_sync_incident_attempts_nonnegative_check" check ("attempts" >= 0);`);

    this.addSql(`create table "bank_sync_incident_attempt" ("bank_sync_incident_attempt_key" serial primary key, "bank_sync_incident_key" int not null, "attempt" int not null, "queue_job_id" varchar(255) not null, "queue_attempt" int not null, "contract_version" varchar(32) not null default 'bank-sync.v1', "event_id" varchar(255) null, "result" text check ("result" in ('full_success', 'partial', 'failed')) null, "final" boolean not null default false, "institution_id" varchar(128) null, "account_count" int null, "requisition_context" varchar(80) not null, "error_category" varchar(128) null, "error_code" varchar(128) null, "started_at" timestamptz not null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null);`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_incident_attempt_unique" unique ("bank_sync_incident_key", "attempt");`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_queue_identity_unique" unique ("bank_sync_incident_key", "queue_job_id", "queue_attempt");`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_event_id_unique" unique ("event_id");`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_incident_foreign" foreign key ("bank_sync_incident_key") references "bank_sync_incident" ("bank_sync_incident_key") on delete no action;`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_positive_check" check ("attempt" > 0);`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_queue_attempt_positive_check" check ("queue_attempt" > 0);`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_account_count_check" check ("account_count" is null or "account_count" >= 0);`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_requisition_context_check" check ("requisition_context" ~ '^reqctx\\.v1:[a-f0-9]{64}$');`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_contract_check" check ("contract_version" = 'bank-sync.v1');`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_completion_check" check (("completed_at" is null and "result" is null and "event_id" is null and "final" = false) or ("completed_at" is not null and "result" is not null and "event_id" is not null));`);
    this.addSql(`alter table "bank_sync_incident_attempt" add constraint "bank_sync_incident_attempt_success_final_check" check ("result" <> 'full_success' or "final" = true);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "bank_sync_incident_attempt" cascade;`);
    this.addSql(`alter table "bank_sync_incident" drop constraint "bank_sync_incident_attempts_nonnegative_check", drop constraint "bank_sync_incident_producer_flow_check", drop constraint "bank_sync_incident_correlation_id_unique";`);
    this.addSql(`alter table "bank_sync_incident" drop column "distinct_id", drop column "environment", drop column "flow", drop column "institution_id", drop column "producer", drop column "requisition_id";`);
  }
}
