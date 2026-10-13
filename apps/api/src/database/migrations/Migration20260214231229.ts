import { Migration } from '@mikro-orm/migrations';

export class Migration20260214231229 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "nordigen_requisition" drop constraint if exists "nordigen_requisition_status_check";`);

    this.addSql(`alter table "category" drop constraint if exists "category_recurrency_check";`);

    this.addSql(
      `alter table "budget_template_income" drop constraint if exists "budget_template_income_recurrency_check";`,
    );

    this.addSql(
      `alter table "budget_template_category" drop constraint if exists "budget_template_category_recurrency_check";`,
    );

    this.addSql(`alter table "payment_invoice" drop constraint if exists "payment_invoice_workflow_status_check";`);

    this.addSql(
      `alter table "payment_invoice_error" drop constraint if exists "payment_invoice_error_error_type_check";`,
    );

    this.addSql(`alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_currency_key_fkey";`);
    this.addSql(`alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_portfolio_key_fkey";`);

    this.addSql(
      `alter table "transaction_category_stats" drop constraint if exists "transaction_category_stats_source_check";`,
    );

    this.addSql(
      `alter table "appuser_merchant_category" drop constraint if exists "appuser_merchant_category_source_check";`,
    );

    this.addSql(
      `alter table "transaction_ocr_import" drop constraint if exists "transaction_ocr_import_status_check";`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" drop constraint if exists "appuser_transaction_category_source_check";`,
    );

    this.addSql(`alter table "financial_asset_price" drop constraint "financial_asset_price_pkey";`);

    this.addSql(
      `alter table "financial_asset_price" add constraint "financial_asset_price_pkey" primary key ("date", "financial_asset_key");`,
    );

    this.addSql(
      `alter table "nordigen_requisition" add constraint "nordigen_requisition_status_check" check("status" in ('created', 'error', 'expired', 'linked'));`,
    );

    this.addSql(
      `alter table "category" add constraint "category_recurrency_check" check("recurrency" in ('ANNUALLY', 'BI_ANNUALLY', 'MONTHLY', 'MONTHLY_14', 'QUARTERLY'));`,
    );

    this.addSql(
      `alter table "budget_template_income" add constraint "budget_template_income_recurrency_check" check("recurrency" in ('ANNUALLY', 'BI_ANNUALLY', 'MONTHLY', 'MONTHLY_14', 'QUARTERLY'));`,
    );

    this.addSql(
      `alter table "budget_template_category" alter column "recurrency" type text using ("recurrency"::text);`,
    );
    this.addSql(`alter table "budget_template_category" alter column "recurrency" drop not null;`);
    this.addSql(
      `alter table "budget_template_category" add constraint "budget_template_category_recurrency_check" check("recurrency" in ('ANNUALLY', 'BI_ANNUALLY', 'MONTHLY', 'MONTHLY_14', 'QUARTERLY'));`,
    );

    this.addSql(
      `alter table "payment_invoice" add constraint "payment_invoice_workflow_status_check" check("workflow_status" in ('INVOICE_CREATED', 'INVOICE_FAILED', 'INVOICE_SENDING_FAILED', 'INVOICE_SENT', 'PAYMENT_FAILED', 'PAYMENT_RECEIVED', 'REFUND_ISSUED'));`,
    );

    this.addSql(
      `alter table "payment_invoice_error" add constraint "payment_invoice_error_error_type_check" check("error_type" in ('customer-creation-failed', 'invalid-vat', 'invoice-failed', 'invoice-receipt-saving-failed', 'invoice-sending-failed', 'other', 'payment-failed'));`,
    );

    this.addSql(`alter table "portfolio" drop column "balance", drop column "appuser_currency_balance";`);

    this.addSql(
      `alter table "portfolio" add column "benchmark_symbol" varchar(20) null default '^GSPC', add column "description" varchar(500) null, add column "target_allocation" jsonb null;`,
    );

    this.addSql(`drop index "idx_portfolio_snapshot_date";`);

    this.addSql(
      `alter table "portfolio_snapshot" add column "appuser_currency_cost_basis" numeric(18, 4) null, add column "appuser_currency_key" int null, add column "appuser_currency_total_value" numeric(18, 4) null;`,
    );
    this.addSql(`alter table "portfolio_snapshot" alter column "created_at" drop default;`);
    this.addSql(
      `alter table "portfolio_snapshot" alter column "created_at" type timestamptz using ("created_at"::timestamptz);`,
    );
    this.addSql(`alter table "portfolio_snapshot" alter column "updated_at" drop default;`);
    this.addSql(
      `alter table "portfolio_snapshot" alter column "updated_at" type timestamptz using ("updated_at"::timestamptz);`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_appuser_currency_key_foreign" foreign key ("appuser_currency_key") references "currency" ("currency_key") on delete set null;`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_portfolio_key_foreign" foreign key ("portfolio_key") references "portfolio" ("portfolio_key");`,
    );
    this.addSql(
      `alter index "idx_portfolio_snapshot_lookup" rename to "portfolio_snapshot_portfolio_key_snapshot_date_index";`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_portfolio_key_snapshot_date_key";`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_portfolio_key_snapshot_date_unique" unique ("portfolio_key", "snapshot_date");`,
    );

    this.addSql(
      `alter table "transaction_category_stats" add constraint "transaction_category_stats_source_check" check("source" in ('manual', 'openai', 'user'));`,
    );

    this.addSql(
      `alter table "appuser_merchant_category" add constraint "appuser_merchant_category_source_check" check("source" in ('manual', 'openai', 'user'));`,
    );

    this.addSql(
      `alter table "transaction_ocr_import" add constraint "transaction_ocr_import_status_check" check("status" in ('Failed', 'Started', 'Success'));`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check("source" in ('manual', 'openai', 'user'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "appuser_merchant_category" drop constraint if exists "appuser_merchant_category_source_check";`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" drop constraint if exists "appuser_transaction_category_source_check";`,
    );

    this.addSql(
      `alter table "budget_template_category" drop constraint if exists "budget_template_category_recurrency_check";`,
    );

    this.addSql(
      `alter table "budget_template_income" drop constraint if exists "budget_template_income_recurrency_check";`,
    );

    this.addSql(`alter table "category" drop constraint if exists "category_recurrency_check";`);

    this.addSql(`alter table "nordigen_requisition" drop constraint if exists "nordigen_requisition_status_check";`);

    this.addSql(`alter table "payment_invoice" drop constraint if exists "payment_invoice_workflow_status_check";`);

    this.addSql(
      `alter table "payment_invoice_error" drop constraint if exists "payment_invoice_error_error_type_check";`,
    );

    this.addSql(`alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_appuser_currency_key_foreign";`);
    this.addSql(`alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_currency_key_foreign";`);
    this.addSql(`alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_portfolio_key_foreign";`);

    this.addSql(
      `alter table "transaction_category_stats" drop constraint if exists "transaction_category_stats_source_check";`,
    );

    this.addSql(
      `alter table "transaction_ocr_import" drop constraint if exists "transaction_ocr_import_status_check";`,
    );

    this.addSql(
      `alter table "appuser_merchant_category" add constraint "appuser_merchant_category_source_check" check("source" in ('user', 'openai', 'manual'));`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" add constraint "appuser_transaction_category_source_check" check("source" in ('user', 'openai', 'manual'));`,
    );

    this.addSql(
      `alter table "budget_template_category" alter column "recurrency" type text using ("recurrency"::text);`,
    );
    this.addSql(`alter table "budget_template_category" alter column "recurrency" set not null;`);
    this.addSql(
      `alter table "budget_template_category" add constraint "budget_template_category_recurrency_check" check("recurrency" in ('MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'BI_ANNUALLY'));`,
    );

    this.addSql(
      `alter table "budget_template_income" add constraint "budget_template_income_recurrency_check" check("recurrency" in ('MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'BI_ANNUALLY'));`,
    );

    this.addSql(
      `alter table "category" add constraint "category_recurrency_check" check("recurrency" in ('MONTHLY_14', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'BI_ANNUALLY'));`,
    );

    this.addSql(`alter table "financial_asset_price" drop constraint "financial_asset_price_pkey";`);

    this.addSql(
      `alter table "financial_asset_price" add constraint "financial_asset_price_pkey" primary key ("financial_asset_key", "date");`,
    );

    this.addSql(
      `alter table "nordigen_requisition" add constraint "nordigen_requisition_status_check" check("status" in ('created', 'linked', 'expired', 'error'));`,
    );

    this.addSql(
      `alter table "payment_invoice" add constraint "payment_invoice_workflow_status_check" check("workflow_status" in ('PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'INVOICE_CREATED', 'INVOICE_FAILED', 'INVOICE_SENT', 'INVOICE_SENDING_FAILED', 'REFUND_ISSUED'));`,
    );

    this.addSql(
      `alter table "payment_invoice_error" add constraint "payment_invoice_error_error_type_check" check("error_type" in ('stripe-invalid-price', 'invalid-vat', 'payment-failed', 'customer-creation-failed', 'invoice-failed', 'invoice-sending-failed', 'other'));`,
    );

    this.addSql(
      `alter table "portfolio" drop column "benchmark_symbol", drop column "description", drop column "target_allocation";`,
    );

    this.addSql(
      `alter table "portfolio" add column "balance" numeric(18,4) null default 0, add column "appuser_currency_balance" numeric(18,4) null default 0;`,
    );

    this.addSql(
      `alter table "portfolio_snapshot" drop column "appuser_currency_cost_basis", drop column "appuser_currency_key", drop column "appuser_currency_total_value";`,
    );

    this.addSql(
      `alter table "portfolio_snapshot" alter column "created_at" type timestamptz(6) using ("created_at"::timestamptz(6));`,
    );
    this.addSql(`alter table "portfolio_snapshot" alter column "created_at" set default now();`);
    this.addSql(
      `alter table "portfolio_snapshot" alter column "updated_at" type timestamptz(6) using ("updated_at"::timestamptz(6));`,
    );
    this.addSql(`alter table "portfolio_snapshot" alter column "updated_at" set default now();`);
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_currency_key_fkey" foreign key ("currency_key") references "currency" ("currency_key") on update no action on delete no action;`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_portfolio_key_fkey" foreign key ("portfolio_key") references "portfolio" ("portfolio_key") on update no action on delete no action;`,
    );
    this.addSql(`create index "idx_portfolio_snapshot_date" on "portfolio_snapshot" ("snapshot_date");`);
    this.addSql(
      `alter index "portfolio_snapshot_portfolio_key_snapshot_date_index" rename to "idx_portfolio_snapshot_lookup";`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" drop constraint "portfolio_snapshot_portfolio_key_snapshot_date_unique";`,
    );
    this.addSql(
      `alter table "portfolio_snapshot" add constraint "portfolio_snapshot_portfolio_key_snapshot_date_key" unique ("portfolio_key", "snapshot_date");`,
    );

    this.addSql(
      `alter table "transaction_category_stats" add constraint "transaction_category_stats_source_check" check("source" in ('user', 'openai', 'manual'));`,
    );

    this.addSql(
      `alter table "transaction_ocr_import" add constraint "transaction_ocr_import_status_check" check("status" in ('Started', 'Success', 'Failed'));`,
    );
  }
}
