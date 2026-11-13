import { Migration } from '@mikro-orm/migrations';

export class Migration20261113200141 extends Migration {

  override name = 'Migration20261113200141';

  override up(): void | Promise<void> {
    this.addSql(`create table "account_ownership" ("account_ownership_key" serial primary key, "created_at" timestamptz not null, "deleted_at" timestamptz null, "updated_at" timestamptz not null, "account_key" int not null, "appuser_key" int not null, "basis_points" int not null, "tenant_key" int not null);`);
    this.addSql(`create index "account_ownership_appuser_key_index" on "account_ownership" ("appuser_key");`);
    this.addSql(`alter table "account_ownership" add constraint "account_ownership_account_key_appuser_key_unique" unique ("account_key", "appuser_key");`);

    this.addSql(`alter table "account_ownership" add constraint "account_ownership_account_key_foreign" foreign key ("account_key") references "account" ("account_key") on delete cascade;`);
    this.addSql(`alter table "account_ownership" add constraint "account_ownership_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete cascade;`);
    this.addSql(`alter table "account_ownership" add constraint "account_ownership_tenant_key_foreign" foreign key ("tenant_key") references "tenant" ("tenant_key");`);
    this.addSql(`alter table "account_ownership" add constraint "account_ownership_basis_points_check" check ("basis_points" >= 0 and "basis_points" <= 10000);`);

    // An account's shares add up to the whole (10000 basis points) or it has none. Checked at
    // commit, so a transaction may replace every row of an account before the total is judged.
    this.addSql(`create function "account_ownership_total_check"() returns trigger language plpgsql as $$
declare
  checked int;
  total bigint;
begin
  foreach checked in array array_remove(array[
    case when tg_op <> 'INSERT' then old."account_key" end,
    case when tg_op <> 'DELETE' then new."account_key" end
  ], null) loop
    select sum("basis_points") into total from "account_ownership" where "account_key" = checked and "deleted_at" is null;
    if total is not null and total <> 10000 then
      raise exception 'account_ownership of account % adds up to % basis points, not 10000', checked, total using errcode = '23514';
    end if;
  end loop;
  return null;
end
$$;`);
    this.addSql(`create constraint trigger "account_ownership_total_check" after insert or update or delete on "account_ownership" deferrable initially deferred for each row execute function "account_ownership_total_check"();`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "account_ownership" cascade;`);
    this.addSql(`drop function if exists "account_ownership_total_check"();`);
  }

}
