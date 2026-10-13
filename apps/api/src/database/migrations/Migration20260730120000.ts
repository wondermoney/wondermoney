import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the `watchlist` table backing the Financial Markets watchlist: one row per
 * (appuser, symbol), tenant-scoped, unique on (appuser_key, symbol). Replaces the
 * previous client-only (localStorage) watchlist so it follows the user across devices.
 */
export class Migration20260730120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "watchlist" ("watchlist_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "appuser_key" int not null, "symbol" varchar(20) not null, "tenant_key" int not null);`);
    this.addSql(`create index "watchlist_tenant_key_appuser_key_index" on "watchlist" ("tenant_key", "appuser_key");`);
    this.addSql(`alter table "watchlist" add constraint "watchlist_appuser_key_symbol_unique" unique ("appuser_key", "symbol");`);
    this.addSql(`alter table "watchlist" add constraint "watchlist_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on update cascade;`);
    this.addSql(`alter table "watchlist" add constraint "watchlist_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "watchlist" cascade;`);
  }

}
