import { Migration } from '@mikro-orm/migrations';

export class Migration20261111010245 extends Migration {

  override name = 'Migration20261111010245';

  override up(): void | Promise<void> {
    this.addSql(`create table "api_token" ("api_token_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "tenant_key" int not null, "name" varchar(80) not null, "prefix" varchar(32) not null, "secret_hash" varchar(64) not null, "scopes" jsonb not null, "expires_at" timestamptz not null, "last_used_at" timestamptz null, "last_used_ip" varchar(64) null, "revoked_at" timestamptz null, "reminder_sent_at" timestamptz null);`);
    this.addSql(`alter table "api_token" add constraint "api_token_secret_hash_unique" unique ("secret_hash");`);
    this.addSql(`create index "api_token_tenant_key_index" on "api_token" ("tenant_key");`);
    this.addSql(`create index "api_token_appuser_key_index" on "api_token" ("appuser_key");`);

    this.addSql(`alter table "api_token" add constraint "api_token_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "api_token" add constraint "api_token_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "api_token" cascade;`);
  }

}
