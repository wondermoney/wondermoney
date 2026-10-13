import { Migration } from '@mikro-orm/migrations';

export class Migration20260604120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "subscription" add column "status" text not null default \'unknown\';');
    this.addSql('alter table "subscription" add constraint "subscription_status_check" check ("status" in (\'active\', \'trialing\', \'past_due\', \'paused\', \'canceled\', \'incomplete\', \'incomplete_expired\', \'unknown\'));');
    this.addSql(`
      create table if not exists "stripe_webhook_event" (
        "stripe_webhook_event_key" serial primary key,
        "event_id" varchar(255) not null,
        "status" text not null check ("status" in ('PROCESSING', 'COMPLETED', 'FAILED')),
        "error_message" text null,
        "processing_started_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null
      );
    `);
    this.addSql(`create unique index if not exists "stripe_webhook_event_event_id_uq" on "stripe_webhook_event" ("event_id") where deleted_at is null;`);
    this.addSql('alter table "transaction_ocr_import" alter column "llm_response" type varchar(1024) using ("llm_response"::varchar(1024));');
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "stripe_webhook_event" cascade;`);
    this.addSql('alter table "transaction_ocr_import" alter column "llm_response" type varchar(255) using (left("llm_response", 255)::varchar(255));');
    this.addSql('alter table "subscription" drop constraint if exists "subscription_status_check";');
    this.addSql('alter table "subscription" drop column "status";');
  }
}
