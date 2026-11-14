import { Migration } from '@mikro-orm/migrations';

export class Migration20261113180332 extends Migration {

  override name = 'Migration20261113180332';

  override up(): void | Promise<void> {
    this.addSql(`create table "expense_group" ("expense_group_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "archived" boolean not null default false, "created_by_appuser_key" int null, "currency_key" int not null, "name" varchar(100) not null, "tenant_key" int not null);`);
    this.addSql(`create index "expense_group_tenant_key_index" on "expense_group" ("tenant_key");`);

    this.addSql(`create table "expense_group_member" ("expense_group_member_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int null, "email" varchar(254) null, "expense_group_key" int not null, "name" varchar(100) not null, "position" int not null default 0, "tenant_key" int not null);`);
    this.addSql(`create index "expense_group_member_expense_group_key_index" on "expense_group_member" ("expense_group_key");`);

    this.addSql(`create table "expense_group_settlement" ("expense_group_settlement_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "amount" numeric(18,4) not null, "currency_key" int not null, "expense_group_key" int not null, "from_member_key" int not null, "notes" varchar(500) null, "recorded_by_appuser_key" int null, "settled_on" date not null, "tenant_key" int not null, "to_member_key" int not null, "transaction_key" int null);`);
    this.addSql(`create index "expense_group_settlement_tenant_key_index" on "expense_group_settlement" ("tenant_key");`);
    this.addSql(`create index "expense_group_settlement_transaction_key_index" on "expense_group_settlement" ("transaction_key");`);
    this.addSql(`create index "expense_group_settlement_expense_group_key_index" on "expense_group_settlement" ("expense_group_key");`);

    this.addSql(`create table "expense_group_expense" ("expense_group_expense_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "expense_group_key" int not null, "paid_by_member_key" int not null, "split_method" text not null, "tenant_key" int not null, "transaction_key" int not null);`);
    this.addSql(`CREATE UNIQUE INDEX expense_group_expense_transaction_live_unique ON expense_group_expense (transaction_key) WHERE deleted_at IS NULL;`);
    this.addSql(`create index "expense_group_expense_expense_group_key_index" on "expense_group_expense" ("expense_group_key");`);

    this.addSql(`alter table "transaction_split" add "expense_group_member_key" int null;`);
    this.addSql(`alter table "transaction_split" add constraint "transaction_split_expense_group_member_key_foreign" foreign key ("expense_group_member_key") references "expense_group_member" ("expense_group_member_key") on delete set null;`);
    this.addSql(`create index "transaction_split_expense_group_member_key_index" on "transaction_split" ("expense_group_member_key");`);

    this.addSql(`alter table "expense_group" add constraint "expense_group_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "expense_group" add constraint "expense_group_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");`);
    this.addSql(`alter table "expense_group" add constraint "expense_group_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);

    this.addSql(`alter table "expense_group_member" add constraint "expense_group_member_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "expense_group_member" add constraint "expense_group_member_expense_group_key_foreign" foreign key ("expense_group_key") references "expense_group" ("expense_group_key") on delete cascade;`);
    this.addSql(`alter table "expense_group_member" add constraint "expense_group_member_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);

    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_expense_group_key_foreign" foreign key ("expense_group_key") references "expense_group" ("expense_group_key") on delete cascade;`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_from_member_key_foreign" foreign key ("from_member_key") references "expense_group_member" ("expense_group_member_key");`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_recorded_by_appuser_key_foreign" foreign key ("recorded_by_appuser_key") references "appuser" ("appuser_key") on delete set null;`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_to_member_key_foreign" foreign key ("to_member_key") references "expense_group_member" ("expense_group_member_key");`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete set null;`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_distinct_members_check" check ("from_member_key" <> "to_member_key");`);
    this.addSql(`alter table "expense_group_settlement" add constraint "expense_group_settlement_amount_positive_check" check ("amount" > 0);`);

    this.addSql(`alter table "expense_group_expense" add constraint "expense_group_expense_expense_group_key_foreign" foreign key ("expense_group_key") references "expense_group" ("expense_group_key") on delete cascade;`);
    this.addSql(`alter table "expense_group_expense" add constraint "expense_group_expense_paid_by_member_key_foreign" foreign key ("paid_by_member_key") references "expense_group_member" ("expense_group_member_key");`);
    this.addSql(`alter table "expense_group_expense" add constraint "expense_group_expense_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "expense_group_expense" add constraint "expense_group_expense_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete cascade;`);
    this.addSql(`alter table "expense_group_expense" add constraint "expense_group_expense_split_method_check" check ("split_method" in ('amounts', 'equal', 'percentages'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "expense_group_member" drop constraint "expense_group_member_expense_group_key_foreign";`);
    this.addSql(`alter table "expense_group_settlement" drop constraint "expense_group_settlement_expense_group_key_foreign";`);
    this.addSql(`alter table "expense_group_expense" drop constraint "expense_group_expense_expense_group_key_foreign";`);
    this.addSql(`alter table "transaction_split" drop constraint "transaction_split_expense_group_member_key_foreign";`);
    this.addSql(`alter table "expense_group_settlement" drop constraint "expense_group_settlement_from_member_key_foreign";`);
    this.addSql(`alter table "expense_group_settlement" drop constraint "expense_group_settlement_to_member_key_foreign";`);
    this.addSql(`alter table "expense_group_expense" drop constraint "expense_group_expense_paid_by_member_key_foreign";`);

    this.addSql(`drop table if exists "expense_group" cascade;`);
    this.addSql(`drop table if exists "expense_group_member" cascade;`);
    this.addSql(`drop table if exists "expense_group_settlement" cascade;`);
    this.addSql(`drop table if exists "expense_group_expense" cascade;`);

    this.addSql(`drop index "transaction_split_expense_group_member_key_index";`);
    this.addSql(`alter table "transaction_split" drop column "expense_group_member_key";`);
  }

}
