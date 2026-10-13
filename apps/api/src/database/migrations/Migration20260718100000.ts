import { Migration } from '@mikro-orm/migrations';

export class Migration20260718100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('create table "email_notification_preference" ("email_notification_preference_key" serial primary key, "appuser_key" int not null, "budget_alerts_enabled" boolean not null default true, "weekly_insights_enabled" boolean not null default true, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null);');
    this.addSql('alter table "email_notification_preference" add constraint "email_notification_preference_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");');
    this.addSql('alter table "email_notification_preference" add constraint "email_notification_preference_appuser_key_unique" unique ("appuser_key");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "email_notification_preference" cascade;');
  }
}
