import { Migration } from '@mikro-orm/migrations';

export class Migration20260803160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "email_notification_preference" add column "monthly_story_enabled" boolean not null default true;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "email_notification_preference" drop column "monthly_story_enabled";');
  }
}
