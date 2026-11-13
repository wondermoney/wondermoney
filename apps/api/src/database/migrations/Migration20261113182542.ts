import { Migration } from '@mikro-orm/migrations';

export class Migration20261113182542 extends Migration {

  override name = 'Migration20261113182542';

  override up(): void | Promise<void> {
    this.addSql(`alter table "budget" add "owner_appuser_key" int null;`);
    this.addSql(`alter table "budget" add constraint "budget_owner_appuser_key_foreign" foreign key ("owner_appuser_key") references "appuser" ("appuser_key") on delete no action;`);
    this.addSql(`create index "budget_tenant_key_owner_appuser_key_idx" on "budget" ("tenant_key", "owner_appuser_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "budget" drop constraint "budget_owner_appuser_key_foreign";`);

    this.addSql(`drop index "budget_tenant_key_owner_appuser_key_idx";`);
    this.addSql(`alter table "budget" drop column "owner_appuser_key";`);
  }

}
