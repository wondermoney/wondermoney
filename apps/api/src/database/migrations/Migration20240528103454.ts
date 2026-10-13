import { Migration } from '@mikro-orm/migrations';

export class Migration20240528103454 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "bonus" drop constraint "bonus_new_user_bonus_type_key_foreign";');
    this.addSql('alter table "bonus" drop constraint "bonus_referral_user_bonus_type_key_foreign";');

    this.addSql('alter table "appuser" drop constraint "appuser_referee_appuser_key_foreign";');

    this.addSql('alter table "referral" drop constraint "referral_referral_origin_appuser_key_foreign";');

    this.addSql(
      'alter table "bonus" drop column "new_user_bonus_type_key", drop column "new_user_bonus_value", drop column "is_stackable", drop column "is_for_new_users_only", drop column "referral_user_bonus_type_key", drop column "referral_user_bonus_value", drop column "create_date", drop column "alter_date", drop column "record_active";',
    );

    this.addSql(
      'alter table "bonus" add column "created_at" timestamptz not null, add column "updated_at" timestamptz not null, add column "deleted_at" timestamptz null, add column "name" varchar(255) not null, add column "type_key" int null, add column "value" numeric null, add column "stripe_discount_code" text null;',
    );
    this.addSql(
      'alter table "bonus" add constraint "bonus_type_key_foreign" foreign key ("type_key") references "bonus_type" ("bonus_type_key") on delete set null;',
    );
    this.addSql('alter table "bonus" rename column "bonus_description" to "description";');

    this.addSql('alter table "promocode" drop column "create_date", drop column "alter_date";');

    this.addSql(
      'alter table "promocode" add column "created_at" timestamptz not null, add column "updated_at" timestamptz not null, add column "deleted_at" timestamptz null;',
    );
    this.addSql('alter table "promocode" alter column "record_active" type boolean using ("record_active"::boolean);');
    this.addSql('alter table "promocode" alter column "record_active" set not null;');

    this.addSql('alter table "appuser" drop column "referee_appuser_key";');

    this.addSql('alter table "referral_origin_type" add column "name" varchar(255) not null;');
    this.addSql(
      'alter table "referral_origin_type" add constraint "referral_origin_type_name_uindex" unique ("name");',
    );

    this.addSql(
      "alter table \"referral_status\" add column \"name\" text check (\"name\" in ('Invited', 'Registered', 'Subscribed', 'TrialExpired')) not null default 'Invited';",
    );
    this.addSql('alter table "referral_status" add constraint "referral_status_name_uindex" unique ("name");');

    this.addSql(
      'alter table "referral" drop column "create_date", drop column "alter_date", drop column "record_active";',
    );

    this.addSql(
      'alter table "referral" add column "created_at" timestamptz not null, add column "updated_at" timestamptz not null, add column "deleted_at" timestamptz null;',
    );
    this.addSql(
      'alter table "referral" alter column "referral_origin_appuser_key" type int using ("referral_origin_appuser_key"::int);',
    );
    this.addSql('alter table "referral" alter column "referral_origin_appuser_key" drop not null;');
    this.addSql(
      'alter table "referral" add constraint "referral_referral_origin_appuser_key_foreign" foreign key ("referral_origin_appuser_key") references "appuser" ("appuser_key") on delete set null;',
    );
    this.addSql(
      'alter table "referral" add constraint "referral_referral_origin_appuser_key_referral_dest_69a99_unique" unique ("referral_origin_appuser_key", "referral_destination_appuser_key", "referral_origin_type_key");',
    );

    this.addSql('alter table "subscription" add column "billing_country" varchar(255) null;');

    this.addSql(
      'alter table "payment_invoice" alter column "workflow_status" type text using ("workflow_status"::text);',
    );
    this.addSql(
      "alter table \"payment_invoice\" add constraint \"payment_invoice_workflow_status_check\" check(\"workflow_status\" in ('PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'INVOICE_CREATED', 'INVOICE_FAILED', 'INVOICE_SENT', 'INVOICE_SENDING_FAILED', 'REFUND_ISSUED'));",
    );
  }

  async down(): Promise<void> {
    this.addSql('alter table "bonus" drop constraint "bonus_type_key_foreign";');

    this.addSql('alter table "payment_invoice" drop constraint if exists "payment_invoice_workflow_status_check";');

    this.addSql('alter table "referral" drop constraint "referral_referral_origin_appuser_key_foreign";');

    this.addSql('alter table "appuser" add column "referee_appuser_key" int4 null;');
    this.addSql(
      'alter table "appuser" add constraint "appuser_referee_appuser_key_foreign" foreign key ("referee_appuser_key") references "appuser" ("appuser_key") on update no action on delete set null;',
    );

    this.addSql(
      'alter table "bonus" drop column "created_at", drop column "updated_at", drop column "deleted_at", drop column "name", drop column "stripe_discount_code";',
    );

    this.addSql(
      'alter table "bonus" add column "is_stackable" bool not null default true, add column "is_for_new_users_only" bool not null default true, add column "referral_user_bonus_type_key" int4 null, add column "referral_user_bonus_value" numeric null, add column "create_date" timestamptz(6) not null, add column "alter_date" timestamptz(6) not null, add column "record_active" bool not null default true;',
    );
    this.addSql(
      'alter table "bonus" add constraint "bonus_referral_user_bonus_type_key_foreign" foreign key ("referral_user_bonus_type_key") references "bonus_type" ("bonus_type_key") on update no action on delete set null;',
    );
    this.addSql('alter table "bonus" rename column "description" to "bonus_description";');
    this.addSql('alter table "bonus" rename column "type_key" to "new_user_bonus_type_key";');
    this.addSql('alter table "bonus" rename column "value" to "new_user_bonus_value";');
    this.addSql(
      'alter table "bonus" add constraint "bonus_new_user_bonus_type_key_foreign" foreign key ("new_user_bonus_type_key") references "bonus_type" ("bonus_type_key") on update no action on delete set null;',
    );

    this.addSql(
      'alter table "payment_invoice" alter column "workflow_status" type int2 using ("workflow_status"::int2);',
    );

    this.addSql(
      'alter table "promocode" drop column "created_at", drop column "updated_at", drop column "deleted_at";',
    );

    this.addSql(
      'alter table "promocode" add column "create_date" timestamptz(6) not null, add column "alter_date" timestamptz(6) not null;',
    );
    this.addSql('alter table "promocode" alter column "record_active" type bool using ("record_active"::bool);');
    this.addSql('alter table "promocode" alter column "record_active" drop not null;');

    this.addSql(
      'alter table "referral" drop constraint "referral_referral_origin_appuser_key_referral_dest_69a99_unique";',
    );
    this.addSql('alter table "referral" drop column "created_at", drop column "updated_at", drop column "deleted_at";');

    this.addSql(
      'alter table "referral" add column "create_date" timestamptz(6) not null, add column "alter_date" timestamptz(6) not null, add column "record_active" bool not null default true;',
    );
    this.addSql(
      'alter table "referral" alter column "referral_origin_appuser_key" type int4 using ("referral_origin_appuser_key"::int4);',
    );
    this.addSql('alter table "referral" alter column "referral_origin_appuser_key" set not null;');
    this.addSql(
      'alter table "referral" add constraint "referral_referral_origin_appuser_key_foreign" foreign key ("referral_origin_appuser_key") references "appuser" ("appuser_key") on update no action on delete no action;',
    );

    this.addSql('alter table "referral_origin_type" drop constraint "referral_origin_type_name_uindex";');
    this.addSql('alter table "referral_origin_type" drop column "name";');

    this.addSql('alter table "referral_status" drop constraint "referral_status_name_uindex";');
    this.addSql('alter table "referral_status" drop column "name";');

    this.addSql('alter table "subscription" drop column "billing_country";');
  }
}
