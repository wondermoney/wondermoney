import { Migration } from '@mikro-orm/migrations';

/**
 * Server-generated Enable Banking keys: `enable_banking_credential.status` gains `pending` (a key
 * pair whose certificate is being registered), and `application_id` becomes nullable, since a
 * pending key has no application yet. A new check keeps every other status tied to an
 * application ID; every existing row has one, so nothing already stored is refused. `down` fails
 * while a pending row exists: delete those rows first.
 */
export class Migration20261126151031 extends Migration {

  override name = 'Migration20261126151031';

  override up(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_credential" drop constraint "enable_banking_credential_status_check";`);
    this.addSql(`alter table "enable_banking_credential" alter column "application_id" drop not null;`);
    this.addSql(`alter table "enable_banking_credential" add constraint "enable_banking_credential_application_id_check" check ("status" = 'pending' or "application_id" is not null);`);
    this.addSql(`alter table "enable_banking_credential" add constraint "enable_banking_credential_status_check" check ("status" in ('active', 'invalid', 'pending', 'revoked'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enable_banking_credential" drop constraint "enable_banking_credential_application_id_check";`);
    this.addSql(`alter table "enable_banking_credential" drop constraint "enable_banking_credential_status_check";`);
    this.addSql(`alter table "enable_banking_credential" alter column "application_id" set not null;`);
    this.addSql(`alter table "enable_banking_credential" add constraint "enable_banking_credential_status_check" check ("status" in ('active', 'invalid', 'revoked'));`);
  }

}
