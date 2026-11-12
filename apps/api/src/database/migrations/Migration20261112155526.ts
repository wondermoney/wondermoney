import { Migration } from '@mikro-orm/migrations';

/**
 * The instance-admin claim from a person's last OIDC sign-in (`services/auth/oidc.ts`), on
 * better-auth's user table. Null for anyone `OIDC_ADMIN_GROUPS` never set it for. It is the one
 * thing kept from the identity provider's groups claim: `recordSignup` reads it to create the
 * app user as an admin.
 */
export class Migration20261112155526 extends Migration {

  override name = 'Migration20261112155526';

  override up(): void | Promise<void> {
    this.addSql(`alter table better_auth."user" add column if not exists "oidcAdmin" boolean;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table better_auth."user" drop column if exists "oidcAdmin";`);
  }

}
