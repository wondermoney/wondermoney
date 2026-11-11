import { Migration } from '@mikro-orm/migrations';

export class Migration20261111095858 extends Migration {

  override name = 'Migration20261111095858';

  override up(): void | Promise<void> {
    this.addSql(`create table "appuser_account_position" ("appuser_account_position_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "account_key" int not null, "position" int not null);`);
    this.addSql(`alter table "appuser_account_position" add constraint "appuser_account_position_appuser_key_account_key_unique" unique ("appuser_key", "account_key");`);

    this.addSql(`alter table "appuser_account_position" add constraint "appuser_account_position_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key");`);
    this.addSql(`alter table "appuser_account_position" add constraint "appuser_account_position_account_key_foreign" foreign key ("account_key") references "account" ("account_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "appuser_account_position" cascade;`);
  }

}
