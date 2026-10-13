import { Migration } from '@mikro-orm/migrations';

export class Migration20251206150603 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create index "budget_template_category_budget_key_index" on "budget_template_category" ("budget_key");`,
    );
    this.addSql(`create index "budget_template_category_year_index" on "budget_template_category" ("year");`);
    this.addSql(`create index "budget_template_category_month_index" on "budget_template_category" ("month");`);
    this.addSql(
      `create index "budget_template_category_budget_key_year_month_index" on "budget_template_category" ("budget_key", "year", "month");`,
    );

    this.addSql(`create index "account_account_owner_appuser_key_index" on "account" ("account_owner_appuser_key");`);
    this.addSql(
      `create index "account_account_owner_appuser_key_deleted_at_index" on "account" ("account_owner_appuser_key", "deleted_at");`,
    );

    this.addSql(`create index "transaction_account_key_index" on "transaction" ("account_key");`);
    this.addSql(`create index "transaction_appuser_key_index" on "transaction" ("appuser_key");`);
    this.addSql(`create index "transaction_transaction_date_index" on "transaction" ("transaction_date");`);
    this.addSql(
      `create index "transaction_account_key_transaction_date_index" on "transaction" ("account_key", "transaction_date");`,
    );
    this.addSql(
      `create index "transaction_appuser_key_transaction_date_index" on "transaction" ("appuser_key", "transaction_date");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "budget_template_category_budget_key_index";`);
    this.addSql(`drop index "budget_template_category_year_index";`);
    this.addSql(`drop index "budget_template_category_month_index";`);
    this.addSql(`drop index "budget_template_category_budget_key_year_month_index";`);

    this.addSql(`drop index "account_account_owner_appuser_key_index";`);
    this.addSql(`drop index "account_account_owner_appuser_key_deleted_at_index";`);

    this.addSql(`drop index "transaction_account_key_index";`);
    this.addSql(`drop index "transaction_appuser_key_index";`);
    this.addSql(`drop index "transaction_transaction_date_index";`);
    this.addSql(`drop index "transaction_account_key_transaction_date_index";`);
    this.addSql(`drop index "transaction_appuser_key_transaction_date_index";`);
  }
}
