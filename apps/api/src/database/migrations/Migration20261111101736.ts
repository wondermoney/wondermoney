import { Migration } from '@mikro-orm/migrations';

export class Migration20261111101736 extends Migration {

  override name = 'Migration20261111101736';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaction_template" ("transaction_template_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "tenant_key" int not null, "owner_appuser_key" int not null, "name" varchar(120) not null, "account_key" int null, "amount" numeric(18,4) null, "direction" text not null, "description" varchar(500) null, "transaction_merchant_key" int null, "category_key" int null, "notes" text null, "position" int not null default 0);`);
    this.addSql(`create index "transaction_template_owner_position_idx" on "transaction_template" ("tenant_key", "owner_appuser_key", "position");`);

    this.addSql(`alter table "transaction_template" add constraint "transaction_template_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "transaction_template" add constraint "transaction_template_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
    this.addSql(`alter table "transaction_template" add constraint "transaction_template_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete set null;`);
    this.addSql(`alter table "transaction_template" add constraint "transaction_template_transaction_merchant_key_foreign" foreign key ("transaction_merchant_key") references "transaction_merchant" ("transaction_merchant_key") on delete set null;`);
    this.addSql(`alter table "transaction_template" add constraint "transaction_template_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on delete set null;`);
    this.addSql(`alter table "transaction_template" add constraint "transaction_template_direction_check" check ("direction" in ('in', 'out'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transaction_template" cascade;`);
  }

}
