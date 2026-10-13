import { Migration } from '@mikro-orm/migrations';

export class Migration20250621152343 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "financial_asset_exchange_aliases" drop constraint "financial_asset_exchange_aliases_financial_asset__ccf5e_foreign";`,
    );
    this.addSql(
      `alter table "financial_asset_exchange_aliases" drop constraint "financial_asset_exchange_aliases_financial_asset__75cd1_foreign";`,
    );

    this.addSql(
      `alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_budget_template_a7290_foreign";`,
    );

    this.addSql(
      `alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset_ccf5e_foreign" foreign key ("financial_asset_exchange_key") references "financial_asset_exchange" ("financial_asset_exchange_key") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset_75cd1_foreign" foreign key ("financial_asset_exchange_alias_key") references "financial_asset_exchange_alias" ("financial_asset_exchange_alias_key") on update cascade on delete cascade;`,
    );

    this.addSql(`alter table "category" drop column "default_household_multiplier";`);

    this.addSql(`alter table "category" add column "default_household_multiplier" numeric(18, 4) not null default 0;`);
    this.addSql(
      `alter table "category" alter column "default_household_amount" type numeric(18, 4) using ("default_household_amount"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_amount" type numeric(18, 4) using ("default_individual_amount"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_multiplier" type numeric(18, 4) using ("default_individual_multiplier"::numeric(18, 4));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_multiplier" set default 0;`);
    this.addSql(
      `alter table "category" alter column "default_individual_adult_amount" type numeric(18, 4) using ("default_individual_adult_amount"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_adult_multiplier" type numeric(18, 4) using ("default_individual_adult_multiplier"::numeric(18, 4));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_adult_multiplier" set default 0;`);
    this.addSql(
      `alter table "category" alter column "default_individual_dependent_amount" type numeric(18, 4) using ("default_individual_dependent_amount"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_dependent_multiplier" type numeric(18, 4) using ("default_individual_dependent_multiplier"::numeric(18, 4));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_dependent_multiplier" set default 0;`);

    this.addSql(
      `alter table "budget_template_category" alter column "amount_budgeted" type numeric(18, 4) using ("amount_budgeted"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "budget_template_category" drop constraint "budget_template_category_budget_key_category_key_y_828a3_unique";`,
    );
    this.addSql(
      `alter table "budget_template_category" add constraint "budget_template_category_budget_key_category_key__828a3_unique" unique ("budget_key", "category_key", "year", "month");`,
    );

    this.addSql(
      `alter table "referral" drop constraint "referral_referral_origin_appuser_key_referral_dest_69a99_unique";`,
    );
    this.addSql(
      `alter table "referral" add constraint "referral_referral_origin_appuser_key_referral_des_69a99_unique" unique ("referral_origin_appuser_key", "referral_destination_appuser_key", "referral_origin_type_key");`,
    );

    this.addSql(
      `alter table "portfolio" alter column "balance" type numeric(18, 4) using ("balance"::numeric(18, 4));`,
    );
    this.addSql(
      `alter table "portfolio" alter column "appuser_currency_balance" type numeric(18, 4) using ("appuser_currency_balance"::numeric(18, 4));`,
    );

    this.addSql(`alter table "account" alter column "balance" type numeric(18, 4) using ("balance"::numeric(18, 4));`);
    this.addSql(
      `alter table "account" alter column "appuser_currency_balance" type numeric(18, 4) using ("appuser_currency_balance"::numeric(18, 4));`,
    );

    this.addSql(
      `alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_budget_templat_a7290_foreign" foreign key ("budget_template_category_budget_template_category_key") references "budget_template_category" ("budget_template_category_key") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "transaction_category_stats" drop constraint "transaction_category_stats_transaction_merchant_ke_bffc3_unique";`,
    );
    this.addSql(
      `alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_k_bffc3_unique" unique ("transaction_merchant_key", "category_key", "source");`,
    );

    this.addSql(
      `alter table "appuser_merchant_category" drop constraint "appuser_merchant_category_appuser_key_transaction__09a21_unique";`,
    );
    this.addSql(
      `alter table "appuser_merchant_category" add constraint "appuser_merchant_category_appuser_key_transaction_09a21_unique" unique ("appuser_key", "transaction_merchant_key", "category_key");`,
    );

    this.addSql(
      `alter table "transaction" alter column "appuser_currency_balance" type numeric(18, 4) using ("appuser_currency_balance"::numeric(18, 4));`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" drop constraint "appuser_transaction_category_appuser_key_transacti_4864d_unique";`,
    );
    this.addSql(
      `alter table "appuser_transaction_category" add constraint "appuser_transaction_category_appuser_key_transact_4864d_unique" unique ("appuser_key", "transaction_key", "category_key");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "financial_asset_exchange_aliases" drop constraint "financial_asset_exchange_aliases_financial_asset_ccf5e_foreign";`,
    );
    this.addSql(
      `alter table "financial_asset_exchange_aliases" drop constraint "financial_asset_exchange_aliases_financial_asset_75cd1_foreign";`,
    );

    this.addSql(
      `alter table "budget_template_category_accounts" drop constraint "budget_template_category_accounts_budget_templat_a7290_foreign";`,
    );

    this.addSql(
      `alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset__ccf5e_foreign" foreign key ("financial_asset_exchange_key") references "financial_asset_exchange" ("financial_asset_exchange_key") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset__75cd1_foreign" foreign key ("financial_asset_exchange_alias_key") references "financial_asset_exchange_alias" ("financial_asset_exchange_alias_key") on update cascade on delete cascade;`,
    );

    this.addSql(`alter table "category" drop column "default_household_multiplier";`);

    this.addSql(`alter table "category" add column "default_household_multiplier" numeric(18, 2) not null default 1;`);
    this.addSql(
      `alter table "category" alter column "default_household_amount" type numeric(18, 2) using ("default_household_amount"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_amount" type numeric(18, 2) using ("default_individual_amount"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_multiplier" type numeric(18, 2) using ("default_individual_multiplier"::numeric(18, 2));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_multiplier" set default 1;`);
    this.addSql(
      `alter table "category" alter column "default_individual_adult_amount" type numeric(18, 2) using ("default_individual_adult_amount"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_adult_multiplier" type numeric(18, 2) using ("default_individual_adult_multiplier"::numeric(18, 2));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_adult_multiplier" set default 1;`);
    this.addSql(
      `alter table "category" alter column "default_individual_dependent_amount" type numeric(18, 2) using ("default_individual_dependent_amount"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "category" alter column "default_individual_dependent_multiplier" type numeric(18, 2) using ("default_individual_dependent_multiplier"::numeric(18, 2));`,
    );
    this.addSql(`alter table "category" alter column "default_individual_dependent_multiplier" set default 1;`);

    this.addSql(
      `alter table "budget_template_category" alter column "amount_budgeted" type numeric(18, 2) using ("amount_budgeted"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "budget_template_category" drop constraint "budget_template_category_budget_key_category_key__828a3_unique";`,
    );
    this.addSql(
      `alter table "budget_template_category" add constraint "budget_template_category_budget_key_category_key_y_828a3_unique" unique ("budget_key", "category_key", "year", "month");`,
    );

    this.addSql(
      `alter table "referral" drop constraint "referral_referral_origin_appuser_key_referral_des_69a99_unique";`,
    );
    this.addSql(
      `alter table "referral" add constraint "referral_referral_origin_appuser_key_referral_dest_69a99_unique" unique ("referral_origin_appuser_key", "referral_destination_appuser_key", "referral_origin_type_key");`,
    );

    this.addSql(
      `alter table "portfolio" alter column "balance" type numeric(18, 2) using ("balance"::numeric(18, 2));`,
    );
    this.addSql(
      `alter table "portfolio" alter column "appuser_currency_balance" type numeric(18, 2) using ("appuser_currency_balance"::numeric(18, 2));`,
    );

    this.addSql(`alter table "account" alter column "balance" type numeric(18, 2) using ("balance"::numeric(18, 2));`);
    this.addSql(
      `alter table "account" alter column "appuser_currency_balance" type numeric(18, 2) using ("appuser_currency_balance"::numeric(18, 2));`,
    );

    this.addSql(
      `alter table "budget_template_category_accounts" add constraint "budget_template_category_accounts_budget_template_a7290_foreign" foreign key ("budget_template_category_budget_template_category_key") references "budget_template_category" ("budget_template_category_key") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "transaction_category_stats" drop constraint "transaction_category_stats_transaction_merchant_k_bffc3_unique";`,
    );
    this.addSql(
      `alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_ke_bffc3_unique" unique ("transaction_merchant_key", "category_key", "source");`,
    );

    this.addSql(
      `alter table "appuser_merchant_category" drop constraint "appuser_merchant_category_appuser_key_transaction_09a21_unique";`,
    );
    this.addSql(
      `alter table "appuser_merchant_category" add constraint "appuser_merchant_category_appuser_key_transaction__09a21_unique" unique ("appuser_key", "transaction_merchant_key", "category_key");`,
    );

    this.addSql(
      `alter table "transaction" alter column "appuser_currency_balance" type numeric(18, 2) using ("appuser_currency_balance"::numeric(18, 2));`,
    );

    this.addSql(
      `alter table "appuser_transaction_category" drop constraint "appuser_transaction_category_appuser_key_transact_4864d_unique";`,
    );
    this.addSql(
      `alter table "appuser_transaction_category" add constraint "appuser_transaction_category_appuser_key_transacti_4864d_unique" unique ("appuser_key", "transaction_key", "category_key");`,
    );
  }
}
