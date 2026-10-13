import { Migration } from '@mikro-orm/migrations';

export class Migration20241116183305 extends Migration {
  async up(): Promise<void> {
    this.addSql('drop table if exists "appuser_social_login" cascade;');
  }

  async down(): Promise<void> {
    this.addSql(
      'create table "appuser_social_login" ("appuser_social_login_key" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "appuser_key" int not null, "external_provider" varchar(255) not null, "auth_token" varchar(255) null, "external_user_id" varchar(255) null, "external_email_address" varchar(255) null, "record_active" boolean not null default true);',
    );

    this.addSql(
      'alter table "appuser_social_login" add constraint "appuser_social_login_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");',
    );
  }
}
