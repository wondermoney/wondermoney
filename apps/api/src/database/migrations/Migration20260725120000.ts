import { Migration } from '@mikro-orm/migrations';

export class Migration20260725120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "email_notification_preference" add column "trial_emails_enabled" boolean not null default true, add column "growth_emails_enabled" boolean not null default true, add column "account_recovery_enabled" boolean not null default true;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "email_notification_preference" drop column "trial_emails_enabled", drop column "growth_emails_enabled", drop column "account_recovery_enabled";');
  }
}
