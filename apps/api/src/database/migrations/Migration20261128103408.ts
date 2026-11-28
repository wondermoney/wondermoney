import { Migration } from '@mikro-orm/migrations';

/**
 * Indexes the foreign keys that erasing a household (`services/privacy/row-erasure.ts`) looks rows
 * up by: Postgres checks every referencing table once per deleted row, so without them one erased
 * household scans the whole `transaction` table once per merchant, plan, goal or account. Additive:
 * indexes only, no data.
 */
export class Migration20261128103408 extends Migration {

  override name = 'Migration20261128103408';

  override up(): void | Promise<void> {
    this.addSql(`create index "budget_template_category_category_key_index" on "budget_template_category" ("category_key");`);

    this.addSql(`create index "financial_transaction_portfolio_key_index" on "financial_transaction" ("portfolio_key");`);

    this.addSql(`create index "portfolio_import_row_imported_financial_transaction_key_index" on "portfolio_import_row" ("imported_financial_transaction_key");`);

    this.addSql(`create index "transaction_category_stats_category_key_index" on "transaction_category_stats" ("category_key");`);

    this.addSql(`create index "appuser_merchant_category_transaction_merchant_key_index" on "appuser_merchant_category" ("transaction_merchant_key");`);
    this.addSql(`create index "appuser_merchant_category_category_key_index" on "appuser_merchant_category" ("category_key");`);

    this.addSql(`create index "transaction_transfer_destination_portfolio_key_index" on "transaction" ("transfer_destination_portfolio_key");`);
    this.addSql(`create index "transaction_transfer_destination_goal_key_index" on "transaction" ("transfer_destination_goal_key");`);
    this.addSql(`create index "transaction_transfer_destination_account_key_index" on "transaction" ("transfer_destination_account_key");`);
    this.addSql(`create index "transaction_installment_plan_key_index" on "transaction" ("installment_plan_key");`);
    this.addSql(`create index "transaction_transaction_merchant_key_index" on "transaction" ("transaction_merchant_key");`);

    this.addSql(`create index "transaction_split_category_key_index" on "transaction_split" ("category_key");`);

    this.addSql(`create index "transaction_ocr_import_transaction_key_index" on "transaction_ocr_import" ("transaction_key");`);

    this.addSql(`create index "transaction_import_row_matched_transaction_key_index" on "transaction_import_row" ("matched_transaction_key");`);
    this.addSql(`create index "transaction_import_row_imported_transaction_key_index" on "transaction_import_row" ("imported_transaction_key");`);

    this.addSql(`create index "transaction_enrichment_category_suggestion_key_index" on "transaction_enrichment" ("category_suggestion_key");`);

    this.addSql(`create index "transaction_audit_log_account_key_index" on "transaction_audit_log" ("account_key");`);

    this.addSql(`create index "transaction_attachment_storage_key_index" on "transaction_attachment" ("storage_key");`);

    this.addSql(`create index "goal_activity_category_key_index" on "goal_activity" ("category_key");`);
    this.addSql(`create index "goal_activity_transaction_key_index" on "goal_activity" ("transaction_key");`);

    this.addSql(`create index "expense_group_expense_transaction_key_index" on "expense_group_expense" ("transaction_key");`);

    this.addSql(`create index "appuser_transaction_category_category_key_index" on "appuser_transaction_category" ("category_key");`);
    this.addSql(`create index "appuser_transaction_category_transaction_key_index" on "appuser_transaction_category" ("transaction_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "appuser_merchant_category_transaction_merchant_key_index";`);
    this.addSql(`drop index "appuser_merchant_category_category_key_index";`);

    this.addSql(`drop index "appuser_transaction_category_category_key_index";`);
    this.addSql(`drop index "appuser_transaction_category_transaction_key_index";`);

    this.addSql(`drop index "budget_template_category_category_key_index";`);

    this.addSql(`drop index "expense_group_expense_transaction_key_index";`);

    this.addSql(`drop index "financial_transaction_portfolio_key_index";`);

    this.addSql(`drop index "goal_activity_category_key_index";`);
    this.addSql(`drop index "goal_activity_transaction_key_index";`);

    this.addSql(`drop index "portfolio_import_row_imported_financial_transaction_key_index";`);

    this.addSql(`drop index "transaction_transfer_destination_portfolio_key_index";`);
    this.addSql(`drop index "transaction_transfer_destination_goal_key_index";`);
    this.addSql(`drop index "transaction_transfer_destination_account_key_index";`);
    this.addSql(`drop index "transaction_installment_plan_key_index";`);
    this.addSql(`drop index "transaction_transaction_merchant_key_index";`);

    this.addSql(`drop index "transaction_attachment_storage_key_index";`);

    this.addSql(`drop index "transaction_audit_log_account_key_index";`);

    this.addSql(`drop index "transaction_category_stats_category_key_index";`);

    this.addSql(`drop index "transaction_enrichment_category_suggestion_key_index";`);

    this.addSql(`drop index "transaction_import_row_matched_transaction_key_index";`);
    this.addSql(`drop index "transaction_import_row_imported_transaction_key_index";`);

    this.addSql(`drop index "transaction_ocr_import_transaction_key_index";`);

    this.addSql(`drop index "transaction_split_category_key_index";`);
  }

}
