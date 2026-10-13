import { Migration } from '@mikro-orm/migrations';

export class Migration20260718110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "sent_email" add column "provider_request_started_at" timestamptz null, add column "provider_outcome" varchar(30) null, add column "provider_message_ids" jsonb null, add column "retryable" boolean null, add column "terminal_reason" varchar(100) null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "sent_email" drop column "provider_request_started_at", drop column "provider_outcome", drop column "provider_message_ids", drop column "retryable", drop column "terminal_reason";');
  }
}
