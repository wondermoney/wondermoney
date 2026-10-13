import { Migration } from '@mikro-orm/migrations';

export class Migration20240320221440 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "subscription_item" drop constraint "subscription_item_subscription_item_charge_cycle_key_foreign";',
    );

    this.addSql('alter table "subscription" drop constraint "subscription_subscription_charge_cycle_key_foreign";');

    this.addSql(
      'alter table "subscription_payment_log" drop constraint "subscription_payment_log_subscription_charge_cycle_key_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_plan" drop constraint "subscription_payment_plan_subscription_charge_status_key_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_instrument" drop constraint "subscription_payment_instrument_subscription_paym_d11b4_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_log" drop constraint "subscription_payment_log_subscription_payment_method_key_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_instrument" drop constraint "subscription_payment_instrument_subscription_paym_62a0a_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_plan" drop constraint "subscription_payment_plan_subscription_charge_ins_c44c3_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_log" drop constraint "subscription_payment_log_subscription_payment_ins_4e1fd_foreign";',
    );

    this.addSql(
      'alter table "subscription_payment_log" drop constraint "subscription_payment_log_subscription_payment_status_key_foreign";',
    );

    this.addSql('alter table "subscription" drop constraint "subscription_subscription_status_key_foreign";');

    this.addSql(
      'alter table "subscription_payment_log" drop constraint "subscription_payment_log_subscription_payment_plan_key_foreign";',
    );

    this.addSql('drop table if exists "subscription_charge_cycle" cascade;');

    this.addSql('drop table if exists "subscription_charge_status" cascade;');

    this.addSql('drop table if exists "subscription_item" cascade;');

    this.addSql('drop table if exists "subscription_payment_method" cascade;');

    this.addSql('drop table if exists "subscription_payment_provider" cascade;');

    this.addSql('drop table if exists "subscription_payment_instrument" cascade;');

    this.addSql('drop table if exists "subscription_payment_status" cascade;');

    this.addSql('drop table if exists "subscription_status" cascade;');

    this.addSql('drop table if exists "subscription_payment_plan" cascade;');

    this.addSql('drop table if exists "subscription_payment_log" cascade;');

    this.addSql('alter table "subscription" drop column "monthly_value";');
    this.addSql('alter table "subscription" drop column "total_value";');
    this.addSql('alter table "subscription" drop column "subscription_status_key";');
    this.addSql('alter table "subscription" drop column "notes";');
    this.addSql('alter table "subscription" drop column "subscription_campaign_code_key";');
    this.addSql('alter table "subscription" drop column "subscription_charge_cycle_key";');
    this.addSql('alter table "subscription" drop column "cancel_date";');
    this.addSql('alter table "subscription" drop column "record_active";');
    this.addSql('alter table "subscription" drop column "billing_address";');
    this.addSql('alter table "subscription" drop column "billing_city";');
    this.addSql('alter table "subscription" drop column "billing_country";');
    this.addSql('alter table "subscription" drop column "billing_postal_code";');
    this.addSql('alter table "subscription" drop column "billing_email";');
    this.addSql('alter table "subscription" drop column "billing_name";');

    this.addSql('alter table "subscription" add column "stripe_subscription_id" text null;');
    this.addSql(
      'alter table "subscription" add constraint "subscription_stripe_subscription_id_unique" unique ("stripe_subscription_id");',
    );
  }

  async down(): Promise<void> {
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
      'create table "subscription_payment_plan" ("subscription_payment_plan_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "subscription_key" int not null, "appuser_key" int not null, "charge_amount" numeric not null, "subscription_charge_instrument_key" int null, "subscription_charge_status_key" int null, "invoice_number" varchar(255) null, "invoice_url" varchar(500) null, "charge_date" timestamptz null);',
    );

    this.addSql(
      'create table "subscription_payment_log" ("subscription_payment_log_key" serial primary key, "subscription_key" int null, "tenant_key" int null, "appuser_key" int null, "payment_amount" numeric null, "currency_key" int null, "payment_intent_id" varchar(255) null, "subscription_payment_instrument_key" int null, "subscription_payment_plan_key" int null, "subscription_charge_cycle_key" int null, "subscription_payment_method_key" int null, "log_date" date not null, "subscription_payment_status_key" int null);',
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

    this.addSql('alter table "subscription" drop constraint "subscription_stripe_subscription_id_unique";');

    this.addSql(
      'alter table "subscription" add column "monthly_value" numeric null, add column "total_value" numeric null, add column "subscription_status_key" int not null, add column "subscription_campaign_code_key" int null, add column "subscription_charge_cycle_key" int not null, add column "cancel_date" timestamptz null, add column "record_active" boolean not null default true, add column "billing_address" text null, add column "billing_city" text null, add column "billing_country" text null, add column "billing_postal_code" text null, add column "billing_email" text null, add column "billing_name" text null;',
    );
    this.addSql(
      'alter table "subscription" add constraint "subscription_subscription_status_key_foreign" foreign key ("subscription_status_key") references "subscription_status" ("subscription_status_key");',
    );
    this.addSql(
      'alter table "subscription" add constraint "subscription_subscription_charge_cycle_key_foreign" foreign key ("subscription_charge_cycle_key") references "subscription_charge_cycle" ("subscription_charge_cycle_key");',
    );
    this.addSql('alter table "subscription" rename column "stripe_subscription_id" to "notes";');
  }
}
