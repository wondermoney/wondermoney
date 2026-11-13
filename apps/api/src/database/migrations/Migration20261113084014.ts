import { Migration } from '@mikro-orm/migrations';

/**
 * Spanish as an account language: `appuser.language` and `bank_recovery_delivery.language_at_send`
 * accept `ES`. Additive (each check only widens), but it replaces two check constraints, so take
 * a database backup before releasing it.
 */

export class Migration20261113084014 extends Migration {

  override name = 'Migration20261113084014';

  override up(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop constraint "appuser_language_check";`);
    this.addSql(`alter table "appuser" add constraint "appuser_language_check" check ("language" in ('EN', 'ES', 'PT'));`);

    this.addSql(`alter table "bank_recovery_delivery" drop constraint "bank_recovery_delivery_language_at_send_check";`);
    this.addSql(`alter table "bank_recovery_delivery" add constraint "bank_recovery_delivery_language_at_send_check" check ("language_at_send" in ('EN', 'ES', 'PT'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop constraint "appuser_language_check";`);
    this.addSql(`alter table "appuser" add constraint "appuser_language_check" check ("language" in ('EN', 'PT'));`);

    this.addSql(`alter table "bank_recovery_delivery" drop constraint "bank_recovery_delivery_language_at_send_check";`);
    this.addSql(`alter table "bank_recovery_delivery" add constraint "bank_recovery_delivery_language_at_send_check" check ("language_at_send" in ('EN', 'PT'));`);
  }

}
