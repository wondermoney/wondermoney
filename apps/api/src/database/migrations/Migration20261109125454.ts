import { Migration } from '@mikro-orm/migrations';

/**
 * Staged transaction imports: `transaction_import_session` (one uploaded file, how to read it and
 * where its accounts go) and `transaction_import_row` (its lines, classified and decided, deleted
 * with their session). Two new, empty tables. Additive only.
 */
export class Migration20261109125454 extends Migration {

  override name = 'Migration20261109125454';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaction_import_session" ("transaction_import_session_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "account_mapping" jsonb null, "account_key" int null, "appuser_key" int not null, "auto_commit" boolean not null default false, "correlation_id" varchar(255) null, "error_code" varchar(100) null, "expires_at" timestamptz not null, "format" varchar(30) not null, "options" jsonb null, "public_id" varchar(36) not null, "s3_bucket" varchar(255) not null, "s3_key" varchar(1024) not null, "source_accounts" jsonb null, "status" text not null default 'waiting_for_upload', "tenant_key" int not null, "warnings" jsonb null);`);
    this.addSql(`create index "transaction_import_session_correlation_id_idx" on "transaction_import_session" ("correlation_id");`);
    this.addSql(`create index "transaction_import_session_status_expires_idx" on "transaction_import_session" ("status", "expires_at");`);
    this.addSql(`create index "transaction_import_session_owner_created_idx" on "transaction_import_session" ("tenant_key", "appuser_key", "created_at");`);
    this.addSql(`alter table "transaction_import_session" add constraint "transaction_import_session_public_id_unique" unique ("public_id");`);

    this.addSql(`create table "transaction_import_row" ("transaction_import_row_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "decision" text null, "error" varchar(500) null, "imported_transaction_key" int null, "matched_transaction_key" int null, "normalized" jsonb null, "raw" jsonb not null, "source_row" int not null, "status" text not null, "target_account_key" int null, "transaction_import_session_key" int not null);`);
    this.addSql(`create index "transaction_import_row_session_status_idx" on "transaction_import_row" ("transaction_import_session_key", "status");`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_session_source_row_unique" unique ("transaction_import_session_key", "source_row");`);

    this.addSql(`alter table "transaction_import_session" add constraint "transaction_import_session_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete set null;`);
    this.addSql(`alter table "transaction_import_session" add constraint "transaction_import_session_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "transaction_import_session" add constraint "transaction_import_session_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_import_session" add constraint "transaction_import_session_status_check" check ("status" in ('cancelled', 'expired', 'failed', 'importing', 'needs_mapping', 'parsing', 'partial', 'ready', 'succeeded', 'waiting_for_upload'));`);

    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_imported_transaction_key_foreign" foreign key ("imported_transaction_key") references "transaction" ("transaction_key") on delete set null;`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_matched_transaction_key_foreign" foreign key ("matched_transaction_key") references "transaction" ("transaction_key") on delete set null;`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_target_account_key_foreign" foreign key ("target_account_key") references "account" ("account_key") on delete set null;`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_transaction_import_session_key_foreign" foreign key ("transaction_import_session_key") references "transaction_import_session" ("transaction_import_session_key") on delete cascade;`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_decision_check" check ("decision" in ('import', 'skip'));`);
    this.addSql(`alter table "transaction_import_row" add constraint "transaction_import_row_status_check" check ("status" in ('duplicate', 'failed', 'imported', 'invalid', 'new', 'possible_duplicate', 'skipped'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction_import_row" drop constraint "transaction_import_row_transaction_import_session_key_foreign";`);

    this.addSql(`drop table if exists "transaction_import_session" cascade;`);
    this.addSql(`drop table if exists "transaction_import_row" cascade;`);
  }

}
