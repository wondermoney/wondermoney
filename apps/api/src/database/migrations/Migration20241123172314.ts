import { Migration } from '@mikro-orm/migrations';

export class Migration20241123172314 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "budget_template_income" drop constraint "budget_template_income_budget_template_key_foreign";',
    );

    this.addSql(
      'alter table "budget_template_category" drop constraint "budget_template_category_budget_template_key_foreign";',
    );

    this.addSql(
      'alter table "budget_template_accounts" drop constraint "budget_template_accounts_budget_template_budget_t_a3b53_foreign";',
    );

    this.addSql('drop table if exists "budget_template" cascade;');

    this.addSql('drop table if exists "budget_template_accounts" cascade;');

    this.addSql(
      'alter table "category" add column "default_individual_adult_amount" int not null default 0, add column "default_individual_adult_multiplier" int not null default 1, add column "default_individual_dependent_amount" int not null default 0, add column "default_individual_dependent_multiplier" int not null default 1, add column "recurrency" text check ("recurrency" in (\'MONTHLY_14\', \'MONTHLY\', \'QUARTERLY\', \'ANNUALLY\', \'BI_ANNUALLY\')) not null default \'MONTHLY\';',
    );

    this.addSql(
      'alter table "budget" add column "num_adults" int not null default 1, add column "num_dependents" int not null default 0, add column "incomes_budget_template_income_key" int not null;',
    );
    this.addSql('alter table "budget" alter column "name" type varchar(255) using ("name"::varchar(255));');
    this.addSql('alter table "budget" alter column "name" set default \'My Budget\';');
    this.addSql(
      'alter table "budget" add constraint "budget_incomes_budget_template_income_key_foreign" foreign key ("incomes_budget_template_income_key") references "budget_template_income" ("budget_template_income_key");',
    );

    this.addSql(
      'alter table "budget_template_income" alter column "amount" type numeric(18, 2) using ("amount"::numeric(18, 2));',
    );
    this.addSql('alter table "budget_template_income" alter column "amount" set not null;');
    this.addSql('alter table "budget_template_income" rename column "budget_template_key" to "budget_key";');
    this.addSql(
      'alter table "budget_template_income" add constraint "budget_template_income_budget_key_foreign" foreign key ("budget_key") references "budget" ("budget_key");',
    );

    this.addSql('alter table "budget_template_category" drop constraint "budget_template_category_pkey";');

    this.addSql(
      'alter table "budget_template_category" add column "budget_template_category_key" int not null, add column "year" int not null, add column "month" int not null, add column "recurrency" text check ("recurrency" in (\'MONTHLY_14\', \'MONTHLY\', \'QUARTERLY\', \'ANNUALLY\', \'BI_ANNUALLY\')) not null default \'MONTHLY\';',
    );
    this.addSql('alter table "budget_template_category" rename column "budget_template_key" to "budget_key";');
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_budget_key_foreign" foreign key ("budget_key") references "budget" ("budget_key");',
    );
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_pkey" primary key ("budget_template_category_key", "budget_key", "category_key");',
    );

    this.addSql(
      'create table "budget_template_category_accounts" ("budget_template_category_budget_template_category_key" int not null, "budget_template_category_budget_key" int not null, "budget_template_category_category_key" int not null, "account_account_key" int not null, constraint "budget_template_category_accounts_pkey" primary key ("budget_template_category_budget_template_category_key", "budget_template_category_budget_key", "budget_template_category_category_key", "account_account_key"));',
    );

    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_budget_template_fae23_foreign" foreign key ("budget_template_category_budget_template_category_key", "budget_template_category_budget_key", "budget_template_category_category_key") references "budget_template_category" ("budget_template_category_key", "budget_key", "category_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_account_account_key_foreign" foreign key ("account_account_key") references "account" ("account_key") on update cascade on delete cascade;',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'create table "budget_template" ("budget_template_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "month" int not null, "year" int not null, "budget_key" int not null);',
    );
    this.addSql(
      'alter table "budget_template" add constraint "budget_template_budget_key_month_year_unique" unique ("budget_key", "month", "year");',
    );

    this.addSql(
      'create table "budget_template_accounts" ("budget_template_budget_template_key" int not null, "account_account_key" int not null, constraint "budget_template_accounts_pkey" primary key ("budget_template_budget_template_key", "account_account_key"));',
    );

    this.addSql(
      'alter table "budget_template" add constraint "budget_template_budget_key_foreign" foreign key ("budget_key") references "budget" ("budget_key");',
    );

    this.addSql(
      'alter table "budget_template_accounts" add constraint "budget_template_accounts_budget_template_budget_t_a3b53_foreign" foreign key ("budget_template_budget_template_key") references "budget_template" ("budget_template_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "budget_template_accounts" add constraint "budget_template_accounts_account_account_key_foreign" foreign key ("account_account_key") references "account" ("account_key") on update cascade on delete cascade;',
    );

    this.addSql('drop table if exists "budget_template_category_accounts" cascade;');

    this.addSql('alter table "budget" drop constraint "budget_incomes_budget_template_income_key_foreign";');

    this.addSql('alter table "budget_template_income" drop constraint "budget_template_income_budget_key_foreign";');

    this.addSql(
      'alter table "budget_template_category" drop constraint "budget_template_category_budget_key_foreign";',
    );

    this.addSql(
      'alter table "category" drop column "default_individual_adult_amount", drop column "default_individual_adult_multiplier", drop column "default_individual_dependent_amount", drop column "default_individual_dependent_multiplier", drop column "recurrency";',
    );

    this.addSql(
      'alter table "budget" drop column "num_adults", drop column "num_dependents", drop column "incomes_budget_template_income_key";',
    );

    this.addSql('alter table "budget" alter column "name" drop default;');
    this.addSql('alter table "budget" alter column "name" type varchar(255) using ("name"::varchar(255));');

    this.addSql(
      'alter table "budget_template_income" alter column "amount" type numeric(18, 2) using ("amount"::numeric(18, 2));',
    );
    this.addSql('alter table "budget_template_income" alter column "amount" drop not null;');
    this.addSql('alter table "budget_template_income" rename column "budget_key" to "budget_template_key";');
    this.addSql(
      'alter table "budget_template_income" add constraint "budget_template_income_budget_template_key_foreign" foreign key ("budget_template_key") references "budget_template" ("budget_template_key");',
    );

    this.addSql('alter table "budget_template_category" drop constraint "budget_template_category_pkey";');
    this.addSql(
      'alter table "budget_template_category" drop column "budget_template_category_key", drop column "year", drop column "month", drop column "recurrency";',
    );

    this.addSql('alter table "budget_template_category" rename column "budget_key" to "budget_template_key";');
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_budget_template_key_foreign" foreign key ("budget_template_key") references "budget_template" ("budget_template_key");',
    );
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_pkey" primary key ("budget_template_key", "category_key");',
    );
  }
}
