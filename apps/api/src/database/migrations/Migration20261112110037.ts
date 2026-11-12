import { Migration } from '@mikro-orm/migrations';

export class Migration20261112110037 extends Migration {

  override name = 'Migration20261112110037';

  override up(): void | Promise<void> {
    this.addSql(`create table "credit_card_due_reminder_delivery" ("credit_card_due_reminder_delivery_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "account_key" int not null, "channel" text not null, "completed_at" timestamptz null, "outcome_code" varchar(64) null, "period_end" date not null, "provider_message_id" varchar(255) null, "sent_at" timestamptz null, "status" text not null default 'pending');`);
    this.addSql(`create index "credit_card_due_reminder_delivery_status_idx" on "credit_card_due_reminder_delivery" ("status");`);
    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_statement_unique" unique ("account_key", "period_end", "channel");`);

    this.addSql(`alter table "email_notification_preference" add "credit_card_due_reminders_enabled" boolean not null default true;`);

    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete cascade;`);
    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_channel_check" check ("channel" in ('email'));`);
    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_status_check" check ("status" in ('failed', 'pending', 'processing', 'sent', 'suppressed', 'unknown'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "credit_card_due_reminder_delivery" cascade;`);

    this.addSql(`alter table "email_notification_preference" drop column "credit_card_due_reminders_enabled";`);
  }

}
