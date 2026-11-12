import { Migration } from '@mikro-orm/migrations';

export class Migration20261112105325 extends Migration {

  override name = 'Migration20261112105325';

  override up(): void | Promise<void> {
    this.addSql(`create table "financial_asset_price_override" ("financial_asset_price_override_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "created_by_appuser_key" int null, "currency_key" int not null, "date" timestamptz not null, "financial_asset_key" int not null, "note" varchar(500) null, "price" numeric not null, "tenant_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX financial_asset_price_override_tenant_asset_date_unique ON financial_asset_price_override (tenant_key, financial_asset_key, date) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table "financial_asset_price_override" add constraint "financial_asset_price_override_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "financial_asset_price_override" add constraint "financial_asset_price_override_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");`);
    this.addSql(`alter table "financial_asset_price_override" add constraint "financial_asset_price_override_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key");`);
    this.addSql(`alter table "financial_asset_price_override" add constraint "financial_asset_price_override_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "financial_asset_price_override" cascade;`);
  }

}
