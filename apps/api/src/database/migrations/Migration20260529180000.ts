import { Migration } from '@mikro-orm/migrations';

export class Migration20260529180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "sent_email" add column "error_message" text null;`);
    this.addSql(`alter table "sent_email" add column "attempt_count" int not null default 0;`);
    this.addSql(`alter table "sent_email" add column "status" varchar(30) not null default 'sent';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sent_email" drop column "error_message";`);
    this.addSql(`alter table "sent_email" drop column "attempt_count";`);
    this.addSql(`alter table "sent_email" drop column "status";`);
  }
}
