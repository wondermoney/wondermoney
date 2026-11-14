import { Migration } from '@mikro-orm/migrations';

export class Migration20261112212116 extends Migration {

  override name = 'Migration20261112212116';

  override up(): void | Promise<void> {
    this.addSql(`create table "installment_plan" ("installment_plan_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "account_key" int not null, "tenant_key" int not null, "created_by_appuser_key" int null, "description" varchar(255) not null, "installment_count" int not null, "purchase_date" date not null, "total_amount" numeric(18, 4) not null, "category_key" int null);`);
    this.addSql(`create index "installment_plan_account_key_index" on "installment_plan" ("account_key");`);
    this.addSql(`create index "installment_plan_tenant_key_index" on "installment_plan" ("tenant_key");`);

    this.addSql(`create table "installment" ("installment_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "installment_plan_key" int not null, "tenant_key" int not null, "installment_number" int not null, "amount" numeric(18, 4) not null, "scheduled_date" date not null, "statement_date" date null, "due_date" date null);`);
    this.addSql(`alter table "installment" add constraint "installment_plan_number_unique" unique ("installment_plan_key", "installment_number");`);

    this.addSql(`alter table "transaction" add "installment_number" int null, add "installment_plan_key" int null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_installment_plan_key_foreign" foreign key ("installment_plan_key") references "installment_plan" ("installment_plan_key") on delete set null;`);
    this.addSql(`CREATE UNIQUE INDEX transaction_installment_unique ON "transaction" (installment_plan_key, installment_number) WHERE installment_plan_key IS NOT NULL AND deleted_at IS NULL;`);

    this.addSql(`alter table "installment_plan" add constraint "installment_plan_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete cascade;`);
    this.addSql(`alter table "installment_plan" add constraint "installment_plan_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "installment_plan" add constraint "installment_plan_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "installment_plan" add constraint "installment_plan_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on delete set null;`);
    this.addSql(`alter table "installment_plan" add constraint "installment_plan_installment_count_check" check (installment_count >= 1);`);
    this.addSql(`alter table "installment_plan" add constraint "installment_plan_total_amount_check" check (total_amount > 0);`);

    this.addSql(`alter table "installment" add constraint "installment_installment_plan_key_foreign" foreign key ("installment_plan_key") references "installment_plan" ("installment_plan_key") on delete cascade;`);
    this.addSql(`alter table "installment" add constraint "installment_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "installment" drop constraint "installment_installment_plan_key_foreign";`);
    this.addSql(`alter table "transaction" drop constraint "transaction_installment_plan_key_foreign";`);

    this.addSql(`drop table if exists "installment_plan" cascade;`);
    this.addSql(`drop table if exists "installment" cascade;`);

    this.addSql(`drop index "transaction_installment_unique";`);
    this.addSql(`alter table "transaction" drop column "installment_number", drop column "installment_plan_key";`);
  }

}
