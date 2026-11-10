import { Migration } from '@mikro-orm/migrations';

/**
 * Bank sync alerts: `bank_sync_alert_delivery` (a new, empty table that deduplicates each alert per
 * connection, event, episode and channel) and the `bank_sync_alerts_enabled` email preference,
 * on by default. Additive only.
 */
export class Migration20261109113845 extends Migration {

  override name = 'Migration20261109113845';

  override up(): void | Promise<void> {
    this.addSql(`create table "bank_sync_alert_delivery" ("bank_sync_alert_delivery_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "channel" text not null, "completed_at" timestamptz null, "enable_banking_connection_key" int not null, "episode_key" varchar(64) not null, "event" text not null, "outcome_code" varchar(64) null, "provider_message_id" varchar(255) null, "sent_at" timestamptz null, "status" text not null default 'pending');`);
    this.addSql(`create index "bank_sync_alert_delivery_status_idx" on "bank_sync_alert_delivery" ("status");`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_episode_unique" unique ("enable_banking_connection_key", "event", "episode_key", "channel");`);

    this.addSql(`alter table "email_notification_preference" add "bank_sync_alerts_enabled" boolean not null default true;`);

    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_enable_banking_connection_key_foreign" foreign key ("enable_banking_connection_key") references "enable_banking_connection" ("enable_banking_connection_key") on delete cascade;`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_channel_check" check ("channel" in ('email'));`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_event_check" check ("event" in ('consent_expiring_1d', 'consent_expiring_7d', 'consent_revoked', 'sync_failing'));`);
    this.addSql(`alter table "bank_sync_alert_delivery" add constraint "bank_sync_alert_delivery_status_check" check ("status" in ('failed', 'pending', 'sending', 'sent', 'suppressed', 'unknown'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "bank_sync_alert_delivery" cascade;`);

    this.addSql(`alter table "email_notification_preference" drop column "bank_sync_alerts_enabled";`);
  }

}
