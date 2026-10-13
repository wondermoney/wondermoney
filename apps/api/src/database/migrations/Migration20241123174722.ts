import { Migration } from '@mikro-orm/migrations';

export class Migration20241123174722 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "budget" drop constraint "budget_incomes_budget_template_income_key_foreign";');

    this.addSql(
      'alter table "budget" alter column "incomes_budget_template_income_key" type int using ("incomes_budget_template_income_key"::int);',
    );
    this.addSql('alter table "budget" alter column "incomes_budget_template_income_key" drop not null;');
    this.addSql(
      'alter table "budget" add constraint "budget_incomes_budget_template_income_key_foreign" foreign key ("incomes_budget_template_income_key") references "budget_template_income" ("budget_template_income_key") on delete set null;',
    );
  }

  async down(): Promise<void> {
    this.addSql('alter table "budget" drop constraint "budget_incomes_budget_template_income_key_foreign";');

    this.addSql(
      'alter table "budget" alter column "incomes_budget_template_income_key" type int using ("incomes_budget_template_income_key"::int);',
    );
    this.addSql('alter table "budget" alter column "incomes_budget_template_income_key" set not null;');
    this.addSql(
      'alter table "budget" add constraint "budget_incomes_budget_template_income_key_foreign" foreign key ("incomes_budget_template_income_key") references "budget_template_income" ("budget_template_income_key");',
    );
  }
}
