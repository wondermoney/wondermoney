import { Migration } from '@mikro-orm/migrations';

export class Migration20260620090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "portfolio_import_asset_mapping" (
      "portfolio_import_asset_mapping_key" serial primary key,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      "tenant_key" int not null,
      "financial_broker_key" int null,
      "identity_hash" varchar(64) not null,
      "isin" varchar(32) null,
      "broker_ticker" varchar(64) null,
      "broker_exchange" varchar(64) null,
      "broker_asset_name" varchar(255) null,
      "currency" varchar(3) null,
      "financial_asset_key" int not null
    );`);
    this.addSql(`alter table "portfolio_import_asset_mapping" add constraint "portfolio_import_asset_mapping_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "portfolio_import_asset_mapping" add constraint "portfolio_import_asset_mapping_financial_broker_key_foreign" foreign key ("financial_broker_key") references "financial_broker" ("financial_broker_key") on delete set null;`);
    this.addSql(`alter table "portfolio_import_asset_mapping" add constraint "portfolio_import_asset_mapping_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key");`);
    this.addSql(`create unique index "portfolio_import_asset_mapping_active_unique" on "portfolio_import_asset_mapping" ("tenant_key", "financial_broker_key", "identity_hash") where "deleted_at" is null and "financial_broker_key" is not null;`);
    this.addSql(`create index "portfolio_import_asset_mapping_lookup_idx" on "portfolio_import_asset_mapping" ("tenant_key", "financial_broker_key", "identity_hash");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "portfolio_import_asset_mapping" cascade;`);
  }
}
