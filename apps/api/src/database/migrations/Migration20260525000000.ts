import { Migration } from '@mikro-orm/migrations';

export class Migration20260525000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "appuser_transaction_category" drop constraint if exists "appuser_transaction_category_source_check";`);
    this.addSql(`alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check("source" in ('manual', 'deterministic', 'openai', 'user'));`);

    this.addSql(`
      create table if not exists "goal" (
        "goal_key" serial primary key,
        "appuser_key" int not null,
        "description" varchar(500) null,
        "icon" varchar(255) null,
        "name" varchar(255) not null,
        "priority" int not null default 0,
        "currency_key" int not null,
        "target_amount" numeric(18,4) not null,
        "target_date" timestamptz null,
        "monthly_contribution_target" numeric(18,4) null,
        "status" text not null default 'active' check ("status" in ('active', 'paused', 'completed', 'archived')),
        "completed_at" timestamptz null,
        "archived_at" timestamptz null,
        "tenant_key" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "goal_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key"),
        constraint "goal_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key"),
        constraint "goal_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key")
      );
    `);
    this.addSql(`create index if not exists "goal_tenant_key_appuser_key_status_deleted_at_index" on "goal" ("tenant_key", "appuser_key", "status", "deleted_at");`);
    this.addSql(`create index if not exists "goal_tenant_key_priority_index" on "goal" ("tenant_key", "priority");`);

    this.addSql(`
      create table if not exists "goal_activity" (
        "goal_activity_key" serial primary key,
        "appuser_key" int not null,
        "created_by_appuser_key" int null,
        "goal_key" int not null,
        "amount" numeric(18,4) null,
        "currency_key" int null,
        "occurred_at" timestamptz not null,
        "type" text not null check ("type" in ('assigned', 'moved_in', 'moved_out', 'spent_from_goal', 'manual_adjustment', 'transaction_funding_reversed', 'goal_created', 'goal_updated', 'paused', 'resumed', 'completed', 'archived')),
        "note" varchar(255) null,
        "transaction_key" int null,
        "category_key" int null,
        "tenant_key" int not null,
        "source_type" varchar(255) null,
        "source_key" int null,
        "destination_type" varchar(255) null,
        "destination_key" int null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "goal_activity_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key"),
        constraint "goal_activity_created_by_appuser_key_foreign" foreign key ("created_by_appuser_key") references "appuser" ("appuser_key") on delete set null,
        constraint "goal_activity_goal_key_foreign" foreign key ("goal_key") references "goal" ("goal_key"),
        constraint "goal_activity_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null,
        constraint "goal_activity_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on delete set null,
        constraint "goal_activity_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on delete set null,
        constraint "goal_activity_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key")
      );
    `);
    this.addSql(`create index if not exists "goal_activity_goal_key_occurred_at_index" on "goal_activity" ("goal_key", "occurred_at");`);
    this.addSql(`create index if not exists "goal_activity_tenant_key_occurred_at_index" on "goal_activity" ("tenant_key", "occurred_at");`);

    this.addSql(`
      create table if not exists "goal_transaction_funding" (
        "goal_transaction_funding_key" serial primary key,
        "goal_key" int not null,
        "amount" numeric(18,4) not null,
        "currency_key" int not null,
        "funding_type" text not null default 'funded_expense' check ("funding_type" in ('funded_expense')),
        "transaction_key" int not null,
        "reversed_at" timestamptz null,
        "tenant_key" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "goal_transaction_funding_goal_key_foreign" foreign key ("goal_key") references "goal" ("goal_key"),
        constraint "goal_transaction_funding_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key"),
        constraint "goal_transaction_funding_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key"),
        constraint "goal_transaction_funding_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key")
      );
    `);
    this.addSql(`create index if not exists "goal_transaction_funding_transaction_key_index" on "goal_transaction_funding" ("transaction_key");`);
    this.addSql(`create index if not exists "goal_transaction_funding_goal_key_reversed_at_index" on "goal_transaction_funding" ("goal_key", "reversed_at");`);

    this.addSql(`
      create table if not exists "goal_account_link" (
        "goal_account_link_key" serial primary key,
        "account_key" int not null,
        "goal_key" int not null,
        "tenant_key" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "goal_account_link_account_key_foreign" foreign key ("account_key") references "account" ("account_key"),
        constraint "goal_account_link_goal_key_foreign" foreign key ("goal_key") references "goal" ("goal_key"),
        constraint "goal_account_link_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key")
      );
    `);
    this.addSql(`create index if not exists "goal_account_link_goal_key_account_key_index" on "goal_account_link" ("goal_key", "account_key");`);
    this.addSql(`create index if not exists "goal_account_link_account_key_index" on "goal_account_link" ("account_key");`);
    this.addSql(
      `create unique index if not exists "goal_account_link_goal_account_active_uq" on "goal_account_link" ("goal_key", "account_key") where deleted_at is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "goal_account_link" cascade;');
    this.addSql('drop table if exists "goal_transaction_funding" cascade;');
    this.addSql('drop table if exists "goal_activity" cascade;');
    this.addSql('drop table if exists "goal" cascade;');

    this.addSql(`alter table "appuser_transaction_category" drop constraint if exists "appuser_transaction_category_source_check";`);
    this.addSql(`alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check("source" in ('manual', 'openai', 'user'));`);
  }
}
