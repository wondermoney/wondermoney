import { Migration } from '@mikro-orm/migrations';

/**
 * Manually valued assets: `manual_asset` (a home, a vehicle, a valuable; tenant, owner, currency,
 * privacy, optional purchase, growth rule and archive date) and `manual_asset_valuation` (what an
 * asset was worth on a day). Two new tables. Additive only.
 */
export class Migration20261110220042 extends Migration {

  override name = 'Migration20261110220042';

  override up(): void | Promise<void> {
    this.addSql(`create table "manual_asset" ("manual_asset_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "archived_at" timestamptz null, "currency_key" int not null, "growth_annual_rate_percent" numeric(9, 4) null, "growth_start_date" date null, "is_private" boolean not null default false, "kind" text not null, "name" varchar(255) not null, "notes" text null, "owner_appuser_key" int not null, "purchase_date" date null, "purchase_price" numeric(18, 4) null, "tenant_key" int not null);`);
    this.addSql(`create index "manual_asset_tenant_key_owner_appuser_key_idx" on "manual_asset" ("tenant_key", "owner_appuser_key");`);

    this.addSql(`create table "manual_asset_valuation" ("manual_asset_valuation_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "manual_asset_key" int not null, "note" text null, "tenant_key" int not null, "valuation_date" date not null, "value" numeric(18, 4) not null);`);
    this.addSql(`create index "manual_asset_valuation_asset_date_idx" on "manual_asset_valuation" ("manual_asset_key", "valuation_date");`);

    this.addSql(`alter table "manual_asset" add constraint "manual_asset_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");`);
    this.addSql(`alter table "manual_asset" add constraint "manual_asset_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "manual_asset" add constraint "manual_asset_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "manual_asset" add constraint "manual_asset_kind_check" check ("kind" in ('other', 'property', 'valuable', 'vehicle'));`);

    this.addSql(`alter table "manual_asset_valuation" add constraint "manual_asset_valuation_manual_asset_key_foreign" foreign key ("manual_asset_key") references "manual_asset" ("manual_asset_key");`);
    this.addSql(`alter table "manual_asset_valuation" add constraint "manual_asset_valuation_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "manual_asset_valuation" cascade;`);
    this.addSql(`drop table if exists "manual_asset" cascade;`);
  }

}
