import { Migration } from '@mikro-orm/migrations';

export class Migration20260619100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "portfolio_import_asset_group" (
      "portfolio_import_asset_group_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "portfolio_import_session_key" int not null,
      "identity_hash" varchar(64) not null,
      "isin" varchar(32) null,
      "broker_ticker" varchar(64) null,
      "broker_exchange" varchar(64) null,
      "broker_asset_name" varchar(255) null,
      "currency" varchar(3) null,
      "status" text not null default 'unmatched',
      "resolution_reason" varchar(255) null,
      "selected_financial_asset_key" int null,
      "selected_action" text null
    );`);
    this.addSql(`create table "portfolio_import_asset_candidate" (
      "portfolio_import_asset_candidate_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "portfolio_import_asset_group_key" int not null,
      "provider" varchar(64) not null,
      "symbol" varchar(64) null,
      "name" varchar(255) null,
      "isin" varchar(32) null,
      "exchange" varchar(64) null,
      "currency" varchar(32) null,
      "confidence" numeric null,
      "rejected_reason" varchar(255) null,
      "has_price_history" boolean not null default false,
      "profile_json" jsonb null
    );`);
    this.addSql(`alter table "portfolio_import_asset_group" add constraint "portfolio_import_asset_group_portfolio_import_session_key_foreign" foreign key ("portfolio_import_session_key") references "portfolio_import_session" ("portfolio_import_session_key") on delete cascade;`);
    this.addSql(`alter table "portfolio_import_asset_group" add constraint "portfolio_import_asset_group_selected_financial_asset_key_foreign" foreign key ("selected_financial_asset_key") references "financial_asset" ("financial_asset_key") on delete set null;`);
    this.addSql(`alter table "portfolio_import_asset_group" add constraint "portfolio_import_asset_group_status_check" check ("status" in ('matched', 'ambiguous', 'unmatched', 'provider_error', 'selected', 'skipped'));`);
    this.addSql(`alter table "portfolio_import_asset_group" add constraint "portfolio_import_asset_group_selected_action_check" check ("selected_action" in ('use_candidate', 'use_existing_asset', 'skip_group') or "selected_action" is null);`);
    this.addSql(`alter table "portfolio_import_asset_candidate" add constraint "portfolio_import_asset_candidate_portfolio_import_asset_group_key_foreign" foreign key ("portfolio_import_asset_group_key") references "portfolio_import_asset_group" ("portfolio_import_asset_group_key") on delete cascade;`);
    this.addSql(`alter table "portfolio_import_row" add constraint "portfolio_import_row_asset_group_key_foreign" foreign key ("asset_group_key") references "portfolio_import_asset_group" ("portfolio_import_asset_group_key") on delete set null;`);
    this.addSql(`create unique index "portfolio_import_asset_group_session_identity_unique" on "portfolio_import_asset_group" ("portfolio_import_session_key", "identity_hash") where "deleted_at" is null;`);
    this.addSql(`create index "portfolio_import_asset_group_session_status_idx" on "portfolio_import_asset_group" ("portfolio_import_session_key", "status");`);
    this.addSql(`create index "portfolio_import_asset_candidate_group_confidence_idx" on "portfolio_import_asset_candidate" ("portfolio_import_asset_group_key", "confidence");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "portfolio_import_row" drop constraint if exists "portfolio_import_row_asset_group_key_foreign";`);
    this.addSql(`drop table if exists "portfolio_import_asset_candidate" cascade;`);
    this.addSql(`drop table if exists "portfolio_import_asset_group" cascade;`);
  }
}
