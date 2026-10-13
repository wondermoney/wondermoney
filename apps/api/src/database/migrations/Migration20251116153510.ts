import { Migration } from '@mikro-orm/migrations';

export class Migration20251116153510 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "sent_email" ("sent_email_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_appuser_key" int not null, "email_type" varchar(100) not null, "sent_at" timestamptz not null, "metadata" jsonb null);`,
    );
    this.addSql(`create index "sent_email_email_type_sent_at_index" on "sent_email" ("email_type", "sent_at");`);
    this.addSql(
      `alter table "sent_email" add constraint "sent_email_appuser_appuser_key_email_type_unique" unique ("appuser_appuser_key", "email_type");`,
    );

    this.addSql(
      `alter table "sent_email" add constraint "sent_email_appuser_appuser_key_foreign" foreign key ("appuser_appuser_key") references "appuser" ("appuser_key") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sent_email" cascade;`);
  }
}
