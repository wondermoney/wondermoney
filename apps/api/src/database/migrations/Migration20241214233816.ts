import { Migration } from '@mikro-orm/migrations';

export class Migration20241214233816 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "budget" drop constraint "budget_incomes_budget_template_income_key_foreign";');

    this.addSql('alter table "budget" drop column "incomes_budget_template_income_key";');
  }

  async down(): Promise<void> {
    this.addSql('alter table "budget" add column "incomes_budget_template_income_key" int null;');
    this.addSql(
      'alter table "budget" add constraint "budget_incomes_budget_template_income_key_foreign" foreign key ("incomes_budget_template_income_key") references "budget_template_income" ("budget_template_income_key") on delete set null;',
    );
  }
}
