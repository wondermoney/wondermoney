import { Migration } from '@mikro-orm/migrations';

export class Migration20240609185517 extends Migration {
  async up(): Promise<void> {
    this.addSql('create extension if not exists pg_trgm;');

    this.addSql(
      'create table "transaction_category_stats" ("transaction_category_stats_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "transaction_merchant_key" int not null, "category_key" int not null, "count" int not null, "source" text check ("source" in (\'user\', \'openai\', \'manual\')) not null, "default" boolean not null default false);',
    );
    this.addSql(
      'alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_ke_bffc3_unique" unique ("transaction_merchant_key", "category_key", "source");',
    );

    this.addSql(
      'create table "appuser_merchant_category" ("appuser_merchant_category_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "transaction_merchant_key" int not null, "category_key" int not null, "source" text check ("source" in (\'user\', \'openai\', \'manual\')) not null);',
    );
    this.addSql(
      'alter table "appuser_merchant_category" add constraint "appuser_merchant_category_appuser_key_transaction__09a21_unique" unique ("appuser_key", "transaction_merchant_key", "category_key");',
    );

    this.addSql(
      'create table "appuser_transaction_category" ("appuser_transaction_category_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "transaction_key" int not null, "category_key" int not null, "source" text check ("source" in (\'user\', \'openai\', \'manual\')) not null);',
    );
    this.addSql(
      'alter table "appuser_transaction_category" add constraint "appuser_transaction_category_appuser_key_transacti_4864d_unique" unique ("appuser_key", "transaction_key", "category_key");',
    );

    this.addSql(
      'alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_key_foreign" foreign key ("transaction_merchant_key") references "transaction_merchant" ("transaction_merchant_key");',
    );
    this.addSql(
      'alter table "transaction_category_stats" add constraint "transaction_category_stats_category_key_foreign" foreign key ("category_key") references "category" ("category_key");',
    );

    this.addSql(
      'alter table "appuser_merchant_category" add constraint "appuser_merchant_category_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "appuser_merchant_category" add constraint "appuser_merchant_category_transaction_merchant_key_foreign" foreign key ("transaction_merchant_key") references "transaction_merchant" ("transaction_merchant_key");',
    );
    this.addSql(
      'alter table "appuser_merchant_category" add constraint "appuser_merchant_category_category_key_foreign" foreign key ("category_key") references "category" ("category_key");',
    );

    this.addSql(
      'alter table "appuser_transaction_category" add constraint "appuser_transaction_category_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "appuser_transaction_category" add constraint "appuser_transaction_category_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key");',
    );
    this.addSql(
      'alter table "appuser_transaction_category" add constraint "appuser_transaction_category_category_key_foreign" foreign key ("category_key") references "category" ("category_key");',
    );

    this.addSql('drop table if exists "transaction_category" cascade;');

    this.addSql('alter table "bonus" drop constraint "bonus_type_key_foreign";');

    this.addSql('alter table "bonus" alter column "type_key" type int using ("type_key"::int);');
    this.addSql('alter table "bonus" alter column "type_key" set not null;');
    this.addSql('alter table "bonus" alter column "value" type numeric using ("value"::numeric);');
    this.addSql('alter table "bonus" alter column "value" set not null;');
    this.addSql(
      'alter table "bonus" add constraint "bonus_type_key_foreign" foreign key ("type_key") references "bonus_type" ("bonus_type_key");',
    );

    this.addSql('alter table "referral_origin_type" drop constraint "referral_origin_type_description_uindex";');

    this.addSql('alter table "referral_origin_type" alter column "name" type text using ("name"::text);');
    this.addSql(
      "alter table \"referral_origin_type\" add constraint \"referral_origin_type_name_check\" check(\"name\" in ('Email', 'Social', 'Url', 'Email Internal', 'Unknown', 'Manual'));",
    );
    this.addSql('alter table "referral_origin_type" drop constraint "referral_origin_type_name_uindex";');
    this.addSql(
      'alter table "referral_origin_type" add constraint "referral_origin_type_name_unique" unique ("name");',
    );

    this.addSql('alter table "payment_invoice_error" alter column "error_type" type text using ("error_type"::text);');
    this.addSql(
      "alter table \"payment_invoice_error\" add constraint \"payment_invoice_error_error_type_check\" check(\"error_type\" in ('stripe-invalid-price', 'invalid-vat', 'payment-failed', 'customer-creation-failed', 'invoice-failed', 'invoice-sending-failed', 'other'));",
    );

    this.addSql(
      'CREATE INDEX transaction_merchant_name_trgm_idx ON transaction_merchant USING gin (name gin_trgm_ops);',
    );

    this.addSql(
      'alter table "transaction" add column "appuser_transaction_category_appuser_transaction_category_key" int null;',
    );
    this.addSql(
      'alter table "transaction" alter column "internal_transaction_id" type varchar(255) using ("internal_transaction_id"::varchar(255));',
    );
    this.addSql('alter table "transaction" alter column "internal_transaction_id" drop not null;');
    this.addSql(
      'alter table "transaction" add constraint "transaction_appuser_transaction_category_appuser__99ef5_foreign" foreign key ("appuser_transaction_category_appuser_transaction_category_key") references "appuser_transaction_category" ("appuser_transaction_category_key") on delete set null;',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "transaction" drop constraint "transaction_appuser_transaction_category_appuser__99ef5_foreign";',
    );

    this.addSql(
      'create table "transaction_category" ("transaction_key" int4 not null, "category_key" int4 not null, constraint "transaction_category_pkey" primary key ("transaction_key", "category_key"));',
    );

    this.addSql(
      'alter table "transaction_category" add constraint "transaction_category_category_key_foreign" foreign key ("category_key") references "category" ("category_key") on update no action on delete no action;',
    );
    this.addSql(
      'alter table "transaction_category" add constraint "transaction_category_transaction_key_foreign" foreign key ("transaction_key") references "transaction" ("transaction_key") on update no action on delete no action;',
    );

    this.addSql('drop table if exists "transaction_category_stats" cascade;');

    this.addSql('drop table if exists "appuser_merchant_category" cascade;');

    this.addSql('drop table if exists "appuser_transaction_category" cascade;');

    this.addSql('alter table "bonus" drop constraint "bonus_type_key_foreign";');

    this.addSql(
      'alter table "payment_invoice_error" drop constraint if exists "payment_invoice_error_error_type_check";',
    );

    this.addSql('alter table "referral_origin_type" drop constraint if exists "referral_origin_type_name_check";');

    this.addSql('alter table "bonus" alter column "type_key" type int4 using ("type_key"::int4);');
    this.addSql('alter table "bonus" alter column "type_key" drop not null;');
    this.addSql('alter table "bonus" alter column "value" type numeric using ("value"::numeric);');
    this.addSql('alter table "bonus" alter column "value" drop not null;');
    this.addSql(
      'alter table "bonus" add constraint "bonus_type_key_foreign" foreign key ("type_key") references "bonus_type" ("bonus_type_key") on update no action on delete set null;',
    );

    this.addSql(
      'alter table "payment_invoice_error" alter column "error_type" type varchar(255) using ("error_type"::varchar(255));',
    );

    this.addSql(
      'alter table "referral_origin_type" alter column "name" type varchar(255) using ("name"::varchar(255));',
    );
    this.addSql(
      'alter table "referral_origin_type" add constraint "referral_origin_type_description_uindex" unique ("description");',
    );
    this.addSql('alter table "referral_origin_type" drop constraint "referral_origin_type_name_unique";');
    this.addSql(
      'alter table "referral_origin_type" add constraint "referral_origin_type_name_uindex" unique ("name");',
    );

    this.addSql(
      'alter table "transaction" drop column "appuser_transaction_category_appuser_transaction_category_key";',
    );

    this.addSql(
      'alter table "transaction" alter column "internal_transaction_id" type varchar(255) using ("internal_transaction_id"::varchar(255));',
    );
    this.addSql('alter table "transaction" alter column "internal_transaction_id" set not null;');

    this.addSql('drop index "transaction_merchant_name_trgm_idx";');
  }
}
