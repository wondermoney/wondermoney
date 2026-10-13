import { Migration } from '@mikro-orm/migrations';

export class Migration20260618130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "portfolio_import_session" (
      "portfolio_import_session_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "tenant_key" int not null,
      "appuser_key" int not null,
      "portfolio_key" int not null,
      "financial_broker_key" int null,
      "s3_bucket" varchar(255) not null,
      "s3_key" varchar(1024) not null,
      "object_etag" varchar(255) null,
      "status" text not null default 'waiting_for_upload',
      "correlation_id" varchar(255) not null,
      "column_mapping_json" jsonb null,
      "summary_json" jsonb null,
      "expires_at" timestamptz null
    );`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_portfolio_key_foreign" foreign key ("portfolio_key") references "portfolio" ("portfolio_key");`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_financial_broker_key_foreign" foreign key ("financial_broker_key") references "financial_broker" ("financial_broker_key") on delete set null;`);
    this.addSql(`alter table "portfolio_import_session" add constraint "portfolio_import_session_status_check" check ("status" in ('waiting_for_upload', 'uploaded', 'parsing', 'needs_column_mapping', 'needs_asset_review', 'ready_to_import', 'importing', 'succeeded', 'partial', 'failed', 'cancelled', 'expired'));`);
    this.addSql(`create unique index "portfolio_import_session_correlation_id_unique" on "portfolio_import_session" ("correlation_id");`);
    this.addSql(`create index "portfolio_import_session_owner_status_idx" on "portfolio_import_session" ("tenant_key", "appuser_key", "portfolio_key", "status");`);
    this.addSql(`create index "portfolio_import_session_portfolio_created_idx" on "portfolio_import_session" ("portfolio_key", "created_at");`);
    this.addSql(`create index "portfolio_import_session_status_updated_idx" on "portfolio_import_session" ("status", "updated_at");`);

    this.addSql(`create table "portfolio_import_row" (
      "portfolio_import_row_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "portfolio_import_session_key" int not null,
      "row_number" int not null,
      "raw_json" jsonb not null,
      "normalized_json" jsonb null,
      "internal_transaction_id" varchar(255) null,
      "status" text not null default 'valid',
      "failure_reason" varchar(255) null,
      "asset_group_key" int null,
      "financial_asset_key" int null,
      "skip_reason" varchar(255) null,
      "imported_financial_transaction_key" int null
    );`);
    this.addSql(`alter table "portfolio_import_row" add constraint "portfolio_import_row_portfolio_import_session_key_foreign" foreign key ("portfolio_import_session_key") references "portfolio_import_session" ("portfolio_import_session_key") on delete cascade;`);
    this.addSql(`alter table "portfolio_import_row" add constraint "portfolio_import_row_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key") on delete set null;`);
    this.addSql(`alter table "portfolio_import_row" add constraint "portfolio_import_row_imported_financial_transaction_key_foreign" foreign key ("imported_financial_transaction_key") references "financial_transaction" ("transaction_key") on delete set null;`);
    this.addSql(`alter table "portfolio_import_row" add constraint "portfolio_import_row_status_check" check ("status" in ('valid', 'invalid', 'duplicate', 'needs_asset_review', 'ready', 'skipped', 'imported', 'failed'));`);
    this.addSql(`create unique index "portfolio_import_row_session_row_number_unique" on "portfolio_import_row" ("portfolio_import_session_key", "row_number");`);
    this.addSql(`create index "portfolio_import_row_session_status_idx" on "portfolio_import_row" ("portfolio_import_session_key", "status");`);
    this.addSql(`create index "portfolio_import_row_internal_transaction_id_idx" on "portfolio_import_row" ("internal_transaction_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "portfolio_import_row" cascade;`);
    this.addSql(`drop table if exists "portfolio_import_session" cascade;`);
  }
}
