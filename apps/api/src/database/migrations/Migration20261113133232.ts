import { Migration } from '@mikro-orm/migrations';

export class Migration20261113133232 extends Migration {

  override name = 'Migration20261113133232';

  override up(): void | Promise<void> {
    this.addSql(`create table "account_share" ("account_share_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "access" text not null, "account_key" int not null, "appuser_key" int not null, "tenant_key" int not null);`);
    this.addSql(`create index "account_share_appuser_key_index" on "account_share" ("appuser_key");`);
    this.addSql(`alter table "account_share" add constraint "account_share_account_key_appuser_key_unique" unique ("account_key", "appuser_key");`);

    this.addSql(`alter table "account_share" add constraint "account_share_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete cascade;`);
    this.addSql(`alter table "account_share" add constraint "account_share_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
    this.addSql(`alter table "account_share" add constraint "account_share_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "account_share" add constraint "account_share_access_check" check ("access" in ('read', 'write'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "account_share" cascade;`);
  }

}
