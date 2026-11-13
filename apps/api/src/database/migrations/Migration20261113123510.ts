import { Migration } from '@mikro-orm/migrations';

export class Migration20261113123510 extends Migration {

  override name = 'Migration20261113123510';

  override up(): void | Promise<void> {
    this.addSql(`alter table "household_invite" add "role" text not null default 'member';`);
    this.addSql(`alter table "household_invite" add constraint "household_invite_role_check" check ("role" in ('admin', 'member', 'owner', 'viewer'));`);

    this.addSql(`alter table "appuser_tenant" drop constraint "appuser_tenant_role_check";`);
    this.addSql(`alter table "appuser_tenant" add constraint "appuser_tenant_role_check" check ("role" in ('admin', 'member', 'owner', 'viewer'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appuser_tenant" drop constraint "appuser_tenant_role_check";`);
    this.addSql(`alter table "appuser_tenant" add constraint "appuser_tenant_role_check" check ("role" in ('member', 'owner'));`);

    this.addSql(`alter table "household_invite" drop constraint "household_invite_role_check";`);
    this.addSql(`alter table "household_invite" drop column "role";`);
  }

}
