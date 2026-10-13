import { Migration } from '@mikro-orm/migrations';

export class Migration20240901212135 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table "budget_template_income" ("budget_template_income_key" serial primary key, "name" text not null, "amount" numeric(18, 2) null default 0, "recurrency" text check ("recurrency" in (\'MONTHLY_14\', \'MONTHLY\', \'QUARTERLY\', \'ANNUALLY\', \'BI_ANNUALLY\')) not null default \'MONTHLY\', "budget_template_key" int not null);',
    );

    this.addSql(
      'alter table "budget_template_income" add constraint "budget_template_income_budget_template_key_foreign" foreign key ("budget_template_key") references "budget_template" ("budget_template_key");',
    );

    this.addSql(
      'alter table "category" add column "default_household_amount" int not null default 0, add column "default_household_multiplier" int not null default 1, add column "default_individual_amount" int not null default 0, add column "default_individual_multiplier" int not null default 1;',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "budget_template_income" cascade;');

    this.addSql(
      'alter table "category" drop column "default_household_amount", drop column "default_household_multiplier", drop column "default_individual_amount", drop column "default_individual_multiplier";',
    );
  }
}
