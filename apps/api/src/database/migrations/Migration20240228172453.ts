import { Migration } from '@mikro-orm/migrations';

export class Migration20240228172453 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table "account_financial_institution" ("account_financial_institution_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "id" varchar(255) not null, "name" varchar(255) not null, "display_name" varchar(255) null);',
    );
    this.addSql(
      'alter table "account_financial_institution" add constraint "account_financial_institution_id_unique" unique ("id");',
    );

    this.addSql(
      'create table "account_type" ("account_type_key" serial primary key, "description" varchar(255) not null);',
    );
    this.addSql('alter table "account_type" add constraint "account_type_description_unique" unique ("description");');

    this.addSql(
      'create table "bonus_type" ("bonus_type_key" serial primary key, "description" varchar(255) not null, "record_active" boolean not null default true);',
    );
    this.addSql('alter table "bonus_type" add constraint "bonus_type_description_uindex" unique ("description");');

    this.addSql(
      'create table "bonus" ("bonus_key" serial primary key, "bonus_description" text null, "new_user_bonus_type_key" int null, "new_user_bonus_value" numeric null, "is_stackable" boolean not null default true, "is_for_new_users_only" boolean not null default true, "referral_user_bonus_type_key" int null, "referral_user_bonus_value" numeric null, "create_date" timestamptz not null, "alter_date" timestamptz not null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'create table "currency" ("currency_key" serial primary key, "code" varchar(10) not null, "num" varchar(10) not null, "decimal_digits" int not null default 2, "description" varchar(255) not null, "is_active" boolean not null default false);',
    );
    this.addSql('alter table "currency" add constraint "currency_code_unique" unique ("code");');

    this.addSql(
      'create table "exchange_rate" ("exchange_rate_key" serial primary key, "from_currency_key" int not null, "to_currency_key" int not null, "rate" numeric not null, "date" timestamptz not null);',
    );
    this.addSql(
      'alter table "exchange_rate" add constraint "exchange_rate_from_currency_key_to_currency_key_date_unique" unique ("from_currency_key", "to_currency_key", "date");',
    );

    this.addSql(
      'create table "financial_asset_exchange" ("financial_asset_exchange_key" serial primary key, "name" varchar(255) not null, "acronym" varchar(255) not null, "country" varchar(255) null, "logo_url" varchar(255) null, "currency_key" int null);',
    );
    this.addSql(
      'alter table "financial_asset_exchange" add constraint "financial_asset_exchange_name_unique" unique ("name");',
    );
    this.addSql(
      'alter table "financial_asset_exchange" add constraint "financial_asset_exchange_acronym_unique" unique ("acronym");',
    );

    this.addSql(
      'create table "financial_asset_exchange_alias" ("financial_asset_exchange_alias_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "financial_asset_exchange_alias" add constraint "financial_asset_exchange_alias_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset_exchange_aliases" ("id" serial primary key, "financial_asset_exchange_key" int not null, "financial_asset_exchange_alias_key" int not null);',
    );

    this.addSql(
      'create table "financial_asset_industry" ("financial_asset_industry_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "financial_asset_industry" add constraint "financial_asset_industry_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset_sector" ("financial_asset_sector_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "financial_asset_sector" add constraint "financial_asset_sector_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset_company" ("financial_asset_company_key" serial primary key, "name" varchar(255) not null, "description" varchar(255) null, "financial_asset_industry_key" int null, "financial_asset_sector_key" int null);',
    );
    this.addSql(
      'alter table "financial_asset_company" add constraint "financial_asset_company_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset_type" ("financial_asset_type_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "financial_asset_type" add constraint "financial_asset_type_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset" ("financial_asset_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) null, "symbol" varchar(255) not null, "isin" varchar(255) null, "fmt_symbol" varchar(255) null, "currency_key" int null, "financial_asset_company_key" int null, "financial_asset_exchange_key" int null, "financial_asset_type_key" int null);',
    );
    this.addSql('alter table "financial_asset" add constraint "financial_asset_symbol_unique" unique ("symbol");');
    this.addSql('alter table "financial_asset" add constraint "financial_asset_isin_unique" unique ("isin");');
    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_fmt_symbol_unique" unique ("fmt_symbol");',
    );

    this.addSql(
      'create table "financial_asset_stock_adjustment" ("financial_asset_stock_adjustment_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null, "date" timestamptz not null, "factor" numeric not null, "dividend" numeric not null, "split_ratio" numeric not null, "financial_asset_key" int not null);',
    );
    this.addSql(
      'alter table "financial_asset_stock_adjustment" add constraint "financial_asset_stock_adjustment_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "financial_asset_price" ("financial_asset_key" int not null, "date" timestamptz not null, "price" numeric not null, "volume" numeric not null, constraint "financial_asset_price_pkey" primary key ("financial_asset_key", "date"));',
    );

    this.addSql(
      'create table "financial_broker" ("financial_broker_key" serial primary key, "name" varchar(255) not null, "display_name" varchar(255) not null);',
    );
    this.addSql('alter table "financial_broker" add constraint "financial_broker_name_unique" unique ("name");');

    this.addSql(
      'create table "financial_transaction_type" ("financial_transaction_type_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "financial_transaction_type" add constraint "financial_transaction_type_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "onboarding" ("onboarding_key" serial primary key, "step" int not null, "description" varchar(255) not null, "active" boolean not null default true);',
    );
    this.addSql('alter table "onboarding" add constraint "onboarding_step_unique" unique ("step");');

    this.addSql(
      'create table "promocode" ("promocode_key" serial primary key, "promocode" varchar(255) not null, "promocode_description" text not null, "bonus_key" int not null, "start_date" timestamptz not null, "end_date" timestamptz null, "create_date" timestamptz not null, "alter_date" timestamptz not null, "record_active" boolean null default true);',
    );
    this.addSql('alter table "promocode" add constraint "promocode_promocode_uindex" unique ("promocode");');

    this.addSql(
      'create table "appuser" ("appuser_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "first_name" varchar(255) null, "last_name" varchar(255) null, "mobile_number_prefix" varchar(10) null, "mobile_number" varchar(20) null, "email_address" varchar(255) not null, "email_authenticated" timestamptz null, "mobile_authenticated" timestamptz null, "record_active" boolean not null default true, "is_obfuscated" timestamptz null, "email_activation_token" varchar(255) null, "email_activation_token_date" timestamptz null, "password_reset_token" varchar(255) null, "password_reset_token_date" timestamptz null, "marketing_opt_in" timestamptz null, "marketing_opt_out" timestamptz null, "twofactor_enabled" boolean not null default false, "twofactor_secret" varchar(255) null, "twofactor_recovery_code" varchar(255) null, "stripe_customer_id" varchar(255) null, "referral_code" varchar(255) not null, "referee_appuser_key" int null, "signup_promocode_key" int null, "currency_key" int not null, "language" text check ("language" in (\'EN\', \'PT\')) not null default \'EN\', "external_user_id" varchar(255) not null);',
    );
    this.addSql('create index "appuser_email_address_index" on "appuser" ("email_address");');
    this.addSql('alter table "appuser" add constraint "appuser_emailaddress_uindex" unique ("email_address");');
    this.addSql(
      'alter table "appuser" add constraint "appuser_emailactivationtoken_uindex" unique ("email_activation_token");',
    );
    this.addSql(
      'alter table "appuser" add constraint "appuser_passwordresettoken_uindex" unique ("password_reset_token");',
    );
    this.addSql('alter table "appuser" add constraint "appuser_referralcode_uindex" unique ("referral_code");');

    this.addSql(
      'create table "nordigen_requisition" ("nordigen_requisition_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "requisition_id" varchar(255) not null, "status" text check ("status" in (\'created\', \'linked\', \'expired\', \'error\')) not null, "appuser_key" int not null, "expires_at" timestamptz null, "internal_reference" varchar(255) not null);',
    );
    this.addSql(
      'alter table "nordigen_requisition" add constraint "nordigen_requisition_requisition_id_uindex" unique ("requisition_id");',
    );

    this.addSql(
      'create table "category" ("category_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null, "icon" varchar(255) null, "bg_color" varchar(255) not null default \'#f3f3f3\', "text_color" varchar(255) not null default \'#030303\', "is_system_category" boolean not null default false, "is_default_budget_category" boolean not null default false, "owner_appuser_key" int null, "parent_category_category_key" int null);',
    );

    this.addSql(
      'create table "budget" ("budget_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null, "description" varchar(255) null, "appuser_key" int not null, "currency_key" int not null);',
    );

    this.addSql(
      'create table "budget_template" ("budget_template_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "month" int not null, "year" int not null, "budget_key" int not null);',
    );
    this.addSql(
      'alter table "budget_template" add constraint "budget_template_budget_key_month_year_unique" unique ("budget_key", "month", "year");',
    );

    this.addSql(
      'create table "budget_template_category" ("budget_template_key" int not null, "category_key" int not null, "amount_budgeted" numeric(18, 2) null default 0, constraint "budget_template_category_pkey" primary key ("budget_template_key", "category_key"));',
    );

    this.addSql(
      'create table "appuser_social_login" ("appuser_social_login_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "external_provider" varchar(255) not null, "auth_token" varchar(255) null, "external_user_id" varchar(255) null, "external_email_address" varchar(255) null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'create table "appuser_onboarding" ("appuser_key" int not null, "onboarding_key" int not null, constraint "appuser_onboarding_pkey" primary key ("appuser_key", "onboarding_key"));',
    );

    this.addSql(
      'create table "referral_origin_type" ("referral_origin_type_key" serial primary key, "description" text not null);',
    );
    this.addSql(
      'alter table "referral_origin_type" add constraint "referral_origin_type_description_uindex" unique ("description");',
    );

    this.addSql(
      'create table "referral_status" ("referral_status_key" serial primary key, "description" varchar(255) not null);',
    );
    this.addSql(
      'alter table "referral_status" add constraint "referral_status_description_uindex" unique ("description");',
    );

    this.addSql(
      'create table "referral" ("referral_key" serial primary key, "referral_origin_type_key" int not null, "referral_origin_appuser_key" int not null, "referral_destination_appuser_key" int null, "referral_status_key" int not null, "signup_date" timestamptz null, "subscription_date" timestamptz null, "bonus_key" int not null, "create_date" timestamptz not null, "email_address" varchar(255) null, "alter_date" timestamptz not null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'create table "subscription_charge_cycle" ("subscription_charge_cycle_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "description" varchar(255) not null, "month_value" numeric not null, "record_active" boolean not null default true);',
    );
    this.addSql(
      'alter table "subscription_charge_cycle" add constraint "subscription_charge_cycle_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "subscription_charge_status" ("subscription_charge_status_key" serial primary key, "description" varchar(25) not null);',
    );
    this.addSql(
      'alter table "subscription_charge_status" add constraint "subscription_charge_status_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "subscription_item" ("subscription_item_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "subscription_item_type" int not null, "subscription_item_charge_cycle_key" int null, "subscription_item_tax_amount" numeric not null, "subscription_item_price" numeric not null, "subscription_item_active" boolean not null default true);',
    );

    this.addSql(
      'create table "subscription_payment_method" ("subscription_payment_method_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "description" varchar(150) not null, "is_deferred" boolean not null, "record_active" boolean not null default true);',
    );
    this.addSql(
      'alter table "subscription_payment_method" add constraint "subscription_payment_method_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "subscription_payment_provider" ("subscription_payment_provider_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "description" varchar(255) not null, "record_active" boolean not null default true);',
    );
    this.addSql(
      'alter table "subscription_payment_provider" add constraint "subscription_payment_provider_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "subscription_payment_instrument" ("subscription_payment_instrument_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "owner_appuser_key" int not null, "subscription_payment_method_key" int not null, "subscription_payment_provider_key" int not null, "instrument_id" text not null, "record_active" boolean not null default true);',
    );
    this.addSql(
      'alter table "subscription_payment_instrument" add constraint "subscription_payment_instrument_instrument_id_unique" unique ("instrument_id");',
    );

    this.addSql(
      'create table "subscription_payment_status" ("subscription_payment_status_key" serial primary key, "description" varchar(255) not null);',
    );
    this.addSql(
      'alter table "subscription_payment_status" add constraint "subscription_payment_status_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "subscription_status" ("subscription_status_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "description" varchar(255) not null, "allow_usage" boolean not null default true, "record_active" boolean not null default true);',
    );
    this.addSql(
      'alter table "subscription_status" add constraint "subscription_status_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "tenant_status" ("tenant_status_key" serial primary key, "description" varchar(50) not null);',
    );
    this.addSql(
      'alter table "tenant_status" add constraint "tenant_status_description_unique" unique ("description");',
    );

    this.addSql(
      'create table "tenant" ("tenant_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) null, "owner_appuser_key" int not null, "tenant_status_key" int not null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'create table "subscription" ("subscription_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "owner_appuser_key" int not null, "monthly_value" numeric null, "total_value" numeric null, "subscription_status_key" int not null, "start_date" timestamptz null, "notes" text null, "subscription_campaign_code_key" int null, "subscription_charge_cycle_key" int not null, "tenant_key" int not null, "end_date" timestamptz null, "cancel_date" timestamptz null, "record_active" boolean not null default true, "billing_address" text null, "billing_city" text null, "billing_country" text null, "billing_postal_code" text null, "billing_email" text null, "billing_name" text null, "billing_tax_id" varchar(255) null);',
    );

    this.addSql(
      'create table "subscription_payment_plan" ("subscription_payment_plan_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "subscription_key" int not null, "appuser_key" int not null, "charge_amount" numeric not null, "subscription_charge_instrument_key" int null, "subscription_charge_status_key" int null, "invoice_number" varchar(255) null, "invoice_url" varchar(500) null, "charge_date" timestamptz null);',
    );

    this.addSql(
      'create table "subscription_payment_log" ("subscription_payment_log_key" serial primary key, "subscription_key" int null, "tenant_key" int null, "appuser_key" int null, "payment_amount" numeric null, "currency_key" int null, "payment_intent_id" varchar(255) null, "subscription_payment_instrument_key" int null, "subscription_payment_plan_key" int null, "subscription_charge_cycle_key" int null, "subscription_payment_method_key" int null, "log_date" date not null, "subscription_payment_status_key" int null);',
    );

    this.addSql(
      'create table "portfolio" ("portfolio_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null, "tenant_key" int not null, "portfolio_owner_appuser_key" int not null, "closed_at" timestamptz null, "currency_key" int not null, "balance" numeric(18, 2) null, "appuser_currency_balance" numeric(18, 2) null, "excluded" boolean not null default false, "favored" boolean not null default false, "refreshed_at" timestamptz null);',
    );

    this.addSql(
      'create table "financial_transaction" ("transaction_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "portfolio_key" int null, "tenant_key" int null, "appuser_key" int null, "financial_transaction_type_key" int null, "financial_broker_key" int null, "financial_asset_key" int null, "transaction_date" timestamptz null, "quantity" numeric not null, "original_unit_amount" numeric null, "original_amount" numeric null, "original_currency_key" int null, "settlement_unit_amount" numeric not null, "settlement_amount" numeric not null, "settlement_currency_key" int not null, "settlement_exchange_rate" numeric null, "appuser_unit_amount" numeric null, "appuser_settlement_amount" numeric null, "appuser_currency_exchange_rate" numeric null, "fee_amount" numeric null, "fee_currency_key" int null, "external_transaction_id" varchar(255) null, "internal_transaction_id" varchar(255) not null, "notes" varchar(255) null);',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_internal_transaction_id_unique" unique ("internal_transaction_id");',
    );

    this.addSql(
      'create table "appuser_tenant" ("appuser_tenant_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "tenant_key" int not null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'create table "account" ("account_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "tenant_key" int not null, "account_owner_appuser_key" int null, "account_number" varchar(255) null, "currency_key" int not null, "balance" numeric(18, 2) null, "appuser_currency_balance" numeric(18, 2) null, "closed" boolean not null default false, "holder_name" varchar(255) null, "account_id" varchar(255) null, "account_name" varchar(255) null, "refreshed_at" timestamptz null, "account_financial_institution_key" int null, "account_type_key" int null, "nordigen_requisition_key" int null);',
    );
    this.addSql('alter table "account" add constraint "account_account_id_unique" unique ("account_id");');

    this.addSql(
      'create table "budget_template_accounts" ("budget_template_budget_template_key" int not null, "account_account_key" int not null, constraint "budget_template_accounts_pkey" primary key ("budget_template_budget_template_key", "account_account_key"));',
    );

    this.addSql(
      'create table "transaction_merchant" ("transaction_merchant_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null);',
    );
    this.addSql(
      'alter table "transaction_merchant" add constraint "transaction_merchant_name_unique" unique ("name");',
    );

    this.addSql(
      'create table "transaction_status" ("transaction_status_key" serial primary key, "name" varchar(255) not null);',
    );
    this.addSql('alter table "transaction_status" add constraint "transaction_status_name_unique" unique ("name");');

    this.addSql(
      'create table "transaction_type" ("transaction_type_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "name" varchar(255) not null, "display_name" varchar(255) not null, "account_financial_institution_key" int null);',
    );
    this.addSql('alter table "transaction_type" add constraint "transaction_type_name_unique" unique ("name");');

    this.addSql(
      'create table "transaction" ("transaction_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "account_key" int null, "tenant_key" int null, "appuser_key" int null, "transaction_type_key" int null, "transaction_merchant_key" int null, "transaction_date" timestamptz null, "original_amount" numeric null, "original_currency_key" int null, "settlement_amount" numeric null, "settlement_currency_key" int null, "edited_settlement_amount" numeric null, "settlement_exchange_rate" numeric null, "appuser_settlement_amount" numeric null, "appuser_currency_key" int null, "appuser_currency_exchange_rate" numeric null, "external_transaction_id" varchar(255) null, "internal_transaction_id" varchar(255) not null, "nordigen_internal_transaction_id" varchar(255) null, "description_dirty" varchar(255) null, "description" varchar(255) null, "notes" varchar(255) null, "transaction_status_key" int null, "balance" numeric null, "appuser_currency_balance" numeric(18, 2) null, "reviewed" boolean not null default false, "processed" boolean not null default false);',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_nordigen_internal_transaction_id_unique" unique ("nordigen_internal_transaction_id");',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_transaction_key_internal_transaction_id_unique" unique ("transaction_key", "internal_transaction_id");',
    );

    this.addSql(
      'create table "transaction_category" ("transaction_key" int not null, "category_key" int not null, constraint "transaction_category_pkey" primary key ("transaction_key", "category_key"));',
    );

    this.addSql(
      'alter table "bonus" add constraint "bonus_new_user_bonus_type_key_foreign" foreign key ("new_user_bonus_type_key") references "bonus_type" ("bonus_type_key") on delete set null;',
    );
    this.addSql(
      'alter table "bonus" add constraint "bonus_referral_user_bonus_type_key_foreign" foreign key ("referral_user_bonus_type_key") references "bonus_type" ("bonus_type_key") on delete set null;',
    );

    this.addSql(
      'alter table "exchange_rate" add constraint "exchange_rate_from_currency_key_foreign" foreign key ("from_currency_key") references "currency" ("currency_key");',
    );
    this.addSql(
      'alter table "exchange_rate" add constraint "exchange_rate_to_currency_key_foreign" foreign key ("to_currency_key") references "currency" ("currency_key");',
    );

    this.addSql(
      'alter table "financial_asset_exchange" add constraint "financial_asset_exchange_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null;',
    );

    this.addSql(
      'alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset__ccf5e_foreign" foreign key ("financial_asset_exchange_key") references "financial_asset_exchange" ("financial_asset_exchange_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "financial_asset_exchange_aliases" add constraint "financial_asset_exchange_aliases_financial_asset__75cd1_foreign" foreign key ("financial_asset_exchange_alias_key") references "financial_asset_exchange_alias" ("financial_asset_exchange_alias_key") on update cascade on delete cascade;',
    );

    this.addSql(
      'alter table "financial_asset_company" add constraint "financial_asset_company_financial_asset_industry_key_foreign" foreign key ("financial_asset_industry_key") references "financial_asset_industry" ("financial_asset_industry_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_asset_company" add constraint "financial_asset_company_financial_asset_sector_key_foreign" foreign key ("financial_asset_sector_key") references "financial_asset_sector" ("financial_asset_sector_key") on delete set null;',
    );

    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_financial_asset_company_key_foreign" foreign key ("financial_asset_company_key") references "financial_asset_company" ("financial_asset_company_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_financial_asset_exchange_key_foreign" foreign key ("financial_asset_exchange_key") references "financial_asset_exchange" ("financial_asset_exchange_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_asset" add constraint "financial_asset_financial_asset_type_key_foreign" foreign key ("financial_asset_type_key") references "financial_asset_type" ("financial_asset_type_key") on delete set null;',
    );

    this.addSql(
      'alter table "financial_asset_stock_adjustment" add constraint "financial_asset_stock_adjustment_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key");',
    );

    this.addSql(
      'alter table "financial_asset_price" add constraint "financial_asset_price_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key");',
    );

    this.addSql(
      'alter table "promocode" add constraint "promocode_bonus_key_foreign" foreign key ("bonus_key") references "bonus" ("bonus_key");',
    );

    this.addSql(
      'alter table "appuser" add constraint "appuser_referee_appuser_key_foreign" foreign key ("referee_appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "appuser" add constraint "appuser_signup_promocode_key_foreign" foreign key ("signup_promocode_key") references "promocode" ("promocode_key") on delete set null;',
    );
    this.addSql(
      'alter table "appuser" add constraint "appuser_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");',
    );

    this.addSql(
      'alter table "nordigen_requisition" add constraint "nordigen_requisition_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );

    this.addSql(
      'alter table "category" add constraint "category_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "category" add constraint "category_parent_category_category_key_foreign" foreign key ("parent_category_category_key") references "category" ("category_key") on update cascade on delete set null;',
    );

    this.addSql(
      'alter table "budget" add constraint "budget_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "budget" add constraint "budget_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");',
    );

    this.addSql(
      'alter table "budget_template" add constraint "budget_template_budget_key_foreign" foreign key ("budget_key") references "budget" ("budget_key");',
    );

    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_budget_template_key_foreign" foreign key ("budget_template_key") references "budget_template" ("budget_template_key");',
    );
    this.addSql(
      'alter table "budget_template_category" add constraint "budget_template_category_category_key_foreign" foreign key ("category_key") references "category" ("category_key");',
    );

    this.addSql(
      'alter table "appuser_social_login" add constraint "appuser_social_login_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );

    this.addSql(
      'alter table "appuser_onboarding" add constraint "appuser_onboarding_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "appuser_onboarding" add constraint "appuser_onboarding_onboarding_key_foreign" foreign key ("onboarding_key") references "onboarding" ("onboarding_key");',
    );

    this.addSql(
      'alter table "referral" add constraint "referral_referral_origin_type_key_foreign" foreign key ("referral_origin_type_key") references "referral_origin_type" ("referral_origin_type_key");',
    );
    this.addSql(
      'alter table "referral" add constraint "referral_referral_origin_appuser_key_foreign" foreign key ("referral_origin_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "referral" add constraint "referral_referral_destination_appuser_key_foreign" foreign key ("referral_destination_appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "referral" add constraint "referral_referral_status_key_foreign" foreign key ("referral_status_key") references "referral_status" ("referral_status_key");',
    );
    this.addSql(
      'alter table "referral" add constraint "referral_bonus_key_foreign" foreign key ("bonus_key") references "bonus" ("bonus_key");',
    );

    this.addSql(
      'alter table "subscription_item" add constraint "subscription_item_subscription_item_charge_cycle_key_foreign" foreign key ("subscription_item_charge_cycle_key") references "subscription_charge_cycle" ("subscription_charge_cycle_key") on delete set null;',
    );

    this.addSql(
      'alter table "subscription_payment_instrument" add constraint "subscription_payment_instrument_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "subscription_payment_instrument" add constraint "subscription_payment_instrument_subscription_paym_d11b4_foreign" foreign key ("subscription_payment_method_key") references "subscription_payment_method" ("subscription_payment_method_key");',
    );
    this.addSql(
      'alter table "subscription_payment_instrument" add constraint "subscription_payment_instrument_subscription_paym_62a0a_foreign" foreign key ("subscription_payment_provider_key") references "subscription_payment_provider" ("subscription_payment_provider_key");',
    );

    this.addSql(
      'alter table "tenant" add constraint "tenant_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "tenant" add constraint "tenant_tenant_status_key_foreign" foreign key ("tenant_status_key") references "tenant_status" ("tenant_status_key");',
    );

    this.addSql(
      'alter table "subscription" add constraint "subscription_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "subscription" add constraint "subscription_subscription_status_key_foreign" foreign key ("subscription_status_key") references "subscription_status" ("subscription_status_key");',
    );
    this.addSql(
      'alter table "subscription" add constraint "subscription_subscription_charge_cycle_key_foreign" foreign key ("subscription_charge_cycle_key") references "subscription_charge_cycle" ("subscription_charge_cycle_key");',
    );
    this.addSql(
      'alter table "subscription" add constraint "subscription_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );

    this.addSql(
      'alter table "subscription_payment_plan" add constraint "subscription_payment_plan_subscription_key_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key");',
    );
    this.addSql(
      'alter table "subscription_payment_plan" add constraint "subscription_payment_plan_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "subscription_payment_plan" add constraint "subscription_payment_plan_subscription_charge_ins_c44c3_foreign" foreign key ("subscription_charge_instrument_key") references "subscription_payment_instrument" ("subscription_payment_instrument_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_plan" add constraint "subscription_payment_plan_subscription_charge_status_key_foreign" foreign key ("subscription_charge_status_key") references "subscription_charge_status" ("subscription_charge_status_key") on delete set null;',
    );

    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_key_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_payment_ins_4e1fd_foreign" foreign key ("subscription_payment_instrument_key") references "subscription_payment_instrument" ("subscription_payment_instrument_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_payment_plan_key_foreign" foreign key ("subscription_payment_plan_key") references "subscription_payment_plan" ("subscription_payment_plan_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_charge_cycle_key_foreign" foreign key ("subscription_charge_cycle_key") references "subscription_charge_cycle" ("subscription_charge_cycle_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_payment_method_key_foreign" foreign key ("subscription_payment_method_key") references "subscription_payment_method" ("subscription_payment_method_key") on delete set null;',
    );
    this.addSql(
      'alter table "subscription_payment_log" add constraint "subscription_payment_log_subscription_payment_status_key_foreign" foreign key ("subscription_payment_status_key") references "subscription_payment_status" ("subscription_payment_status_key") on delete set null;',
    );

    this.addSql(
      'alter table "portfolio" add constraint "portfolio_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );
    this.addSql(
      'alter table "portfolio" add constraint "portfolio_portfolio_owner_appuser_key_foreign" foreign key ("portfolio_owner_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "portfolio" add constraint "portfolio_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");',
    );

    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_portfolio_key_foreign" foreign key ("portfolio_key") references "portfolio" ("portfolio_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_financial_transaction_type_key_foreign" foreign key ("financial_transaction_type_key") references "financial_transaction_type" ("financial_transaction_type_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_financial_broker_key_foreign" foreign key ("financial_broker_key") references "financial_broker" ("financial_broker_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_financial_asset_key_foreign" foreign key ("financial_asset_key") references "financial_asset" ("financial_asset_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_original_currency_key_foreign" foreign key ("original_currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_settlement_currency_key_foreign" foreign key ("settlement_currency_key") references "currency" ("currency_key");',
    );
    this.addSql(
      'alter table "financial_transaction" add constraint "financial_transaction_fee_currency_key_foreign" foreign key ("fee_currency_key") references "currency" ("currency_key") on delete set null;',
    );

    this.addSql(
      'alter table "appuser_tenant" add constraint "appuser_tenant_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "appuser_tenant" add constraint "appuser_tenant_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );

    this.addSql(
      'alter table "account" add constraint "account_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");',
    );
    this.addSql(
      'alter table "account" add constraint "account_account_owner_appuser_key_foreign" foreign key ("account_owner_appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "account" add constraint "account_currency_key_foreign" foreign key ("currency_key") references "currency" ("currency_key");',
    );
    this.addSql(
      'alter table "account" add constraint "account_account_financial_institution_key_foreign" foreign key ("account_financial_institution_key") references "account_financial_institution" ("account_financial_institution_key") on delete set null;',
    );
    this.addSql(
      'alter table "account" add constraint "account_account_type_key_foreign" foreign key ("account_type_key") references "account_type" ("account_type_key") on delete set null;',
    );
    this.addSql(
      'alter table "account" add constraint "account_nordigen_requisition_key_foreign" foreign key ("nordigen_requisition_key") references "nordigen_requisition" ("nordigen_requisition_key") on delete set null;',
    );

    this.addSql(
      'alter table "budget_template_accounts" add constraint "budget_template_accounts_budget_template_budget_t_a3b53_foreign" foreign key ("budget_template_budget_template_key") references "budget_template" ("budget_template_key") on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table "budget_template_accounts" add constraint "budget_template_accounts_account_account_key_foreign" foreign key ("account_account_key") references "account" ("account_key") on update cascade on delete cascade;',
    );

    this.addSql(
      'alter table "transaction_type" add constraint "transaction_type_account_financial_institution_key_foreign" foreign key ("account_financial_institution_key") references "account_financial_institution" ("account_financial_institution_key") on delete set null;',
    );

    this.addSql(
      'alter table "transaction" add constraint "transaction_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_transaction_type_key_foreign" foreign key ("transaction_type_key") references "transaction_type" ("transaction_type_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_transaction_merchant_key_foreign" foreign key ("transaction_merchant_key") references "transaction_merchant" ("transaction_merchant_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_original_currency_key_foreign" foreign key ("original_currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_settlement_currency_key_foreign" foreign key ("settlement_currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_appuser_currency_key_foreign" foreign key ("appuser_currency_key") references "currency" ("currency_key") on delete set null;',
    );
    this.addSql(
      'alter table "transaction" add constraint "transaction_transaction_status_key_foreign" foreign key ("transaction_status_key") references "transaction_status" ("transaction_status_key") on delete set null;',
    );

    this.addSql(
      'alter table "transaction_category" add constraint "transaction_category_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key");',
    );
    this.addSql(
      'alter table "transaction_category" add constraint "transaction_category_category_key_foreign" foreign key ("category_key") references "category" ("category_key");',
    );
  }
}
