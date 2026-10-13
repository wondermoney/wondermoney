import { Migration } from '@mikro-orm/migrations';

export class Migration20240409171424 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table "payment_invoice" ("payment_invoice_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "owner_appuser_key" int not null, "billing_tax_id" varchar(255) null, "subscription_key" int not null, "stripe_event_ids" text[] null, "document_ids" text[] null, "workflow_status" smallint not null, "total_value" int null, "tax_value" int null, "tax_value_percentage" int null, "invoice_document_url" varchar(255) null);',
    );

    this.addSql(
      'create table "payment_invoice_error" ("payment_invoice_error_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "payment_invoice_key" int null, "subscription_key" int not null, "error_type" varchar(255) not null, "error" varchar(255) not null);',
    );

    this.addSql(
      'alter table "payment_invoice" add constraint "payment_invoice_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key");',
    );
    this.addSql(
      'alter table "payment_invoice" add constraint "payment_invoice_subscription_key_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key");',
    );

    this.addSql(
      'alter table "payment_invoice_error" add constraint "payment_invoice_error_payment_invoice_key_foreign" foreign key ("payment_invoice_key") references "payment_invoice" ("payment_invoice_key") on delete set null;',
    );
    this.addSql(
      'alter table "payment_invoice_error" add constraint "payment_invoice_error_subscription_key_foreign" foreign key ("subscription_key") references "subscription" ("subscription_key");',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "payment_invoice_error" drop constraint "payment_invoice_error_payment_invoice_key_foreign";',
    );

    this.addSql('drop table if exists "payment_invoice" cascade;');

    this.addSql('drop table if exists "payment_invoice_error" cascade;');
  }
}
