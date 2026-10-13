import { Migration } from '@mikro-orm/migrations';

export class Migration20240229184026 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table "marketing_email" ("marketing_email_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "email_address" varchar(255) not null, "source" varchar(255) null);',
    );
    this.addSql(
      'alter table "marketing_email" add constraint "marketing_email_email_address_source_unique" unique ("email_address", "source");',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "marketing_email" cascade;');
  }
}
