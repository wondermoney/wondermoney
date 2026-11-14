import { Migration } from '@mikro-orm/migrations';

/**
 * A connection made with the instance-wide Enable Banking credential has no user credential row:
 * `enable_banking_connection.enable_banking_credential_key` becomes nullable. The foreign key is
 * unchanged (no action on delete).
 */
export class Migration20261113023601 extends Migration {

  override name = 'Migration20261113023601';

  override up(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_connection" alter column "enable_banking_credential_key" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_connection" alter column "enable_banking_credential_key" set not null;`);
  }

}
