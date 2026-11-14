import { Migration } from '@mikro-orm/migrations';

/**
 * Mobile push notifications (`services/push`): the devices that registered an Expo push token, the
 * dedupe for budget-alert pushes, three push categories on the notification preferences (off by
 * default), and `push` as a channel for card reminders and bank sync alerts.
 */
export class Migration20261113072142 extends Migration {

  override name = 'Migration20261113072142';

  override up(): void | Promise<void> {
    this.addSql(`create table "push_device" ("push_device_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "app_version" varchar(32) null, "disabled_at" timestamptz null, "last_seen_at" timestamptz not null, "platform" text not null, "session_id" varchar(64) null, "token" varchar(255) not null);`);
    this.addSql(`alter table "push_device" add constraint "push_device_token_unique" unique ("token");`);
    this.addSql(`create index "push_device_session_id_index" on "push_device" ("session_id");`);

    this.addSql(`create table "push_notification_claim" ("push_notification_claim_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "dedupe_key" varchar(128) not null);`);
    this.addSql(`alter table "push_notification_claim" add constraint "push_notification_claim_appuser_dedupe_unique" unique ("appuser_key", "dedupe_key");`);

    this.addSql(`alter table "email_notification_preference" add "push_bank_sync_alerts_enabled" boolean not null default false, add "push_budget_alerts_enabled" boolean not null default false, add "push_credit_card_due_reminders_enabled" boolean not null default false;`);

    this.addSql(`alter table "bank_sync_alert_delivery" drop constraint "bank_sync_alert_delivery_channel_check";`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_channel_check" check ("channel" in ('email', 'push'));`);

    this.addSql(`alter table "credit_card_due_reminder_delivery" drop constraint "credit_card_due_reminder_delivery_channel_check";`);
    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_channel_check" check ("channel" in ('email', 'push'));`);

    this.addSql(`alter table "push_device" add constraint "push_device_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
    this.addSql(`alter table "push_device" add constraint "push_device_platform_check" check ("platform" in ('android', 'ios'));`);

    this.addSql(`alter table "push_notification_claim" add constraint "push_notification_claim_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "push_device" cascade;`);
    this.addSql(`drop table if exists "push_notification_claim" cascade;`);

    this.addSql(`alter table "bank_sync_alert_delivery" drop constraint "bank_sync_alert_delivery_channel_check";`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_channel_check" check ("channel" in ('email'));`);

    this.addSql(`alter table "credit_card_due_reminder_delivery" drop constraint "credit_card_due_reminder_delivery_channel_check";`);
    this.addSql(`alter table "credit_card_due_reminder_delivery" add constraint "credit_card_due_reminder_delivery_channel_check" check ("channel" in ('email'));`);

    this.addSql(`alter table "email_notification_preference" drop column "push_bank_sync_alerts_enabled", drop column "push_budget_alerts_enabled", drop column "push_credit_card_due_reminders_enabled";`);
  }

}
