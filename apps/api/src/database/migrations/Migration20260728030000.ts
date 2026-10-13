import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `referral_reminder_delivery`: one row per `Referral`, tracking the
 * single one-time reminder sent to an invitee who hasn't signed up yet.
 * The recipient has no Appuser, so this can't reuse `lifecycle_delivery`.
 */
export class Migration20260728030000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "referral_reminder_delivery" ("referral_reminder_delivery_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "opted_out_at" timestamptz null, "outcome_code" varchar(128) null, "provider_message_id" varchar(255) null, "referral_key" int not null, "sent_at" timestamptz null, "status" text not null default 'pending' check ("status" in ('failed', 'pending', 'sent', 'suppressed')), "template_version" varchar(64) not null);`);
    this.addSql(`alter table "referral_reminder_delivery" add constraint "referral_reminder_delivery_referral_key_unique" unique ("referral_key");`);

    this.addSql(`alter table "referral_reminder_delivery" add constraint "referral_reminder_delivery_referral_key_foreign" foreign key ("referral_key") references "referral" ("referral_key") on delete no action;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "referral_reminder_delivery" cascade;`);
  }

}
