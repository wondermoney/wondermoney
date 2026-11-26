import { Migration } from '@mikro-orm/migrations';

export class Migration20261126093126 extends Migration {

  override name = 'Migration20261126093126';

  override up(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop constraint "appuser_language_check";`);
    this.addSql(`alter table "appuser" add constraint "appuser_language_check" check ("language" in ('EN', 'ES', 'IT', 'PT'));`);

    this.addSql(`alter table "bank_recovery_delivery" drop constraint "bank_recovery_delivery_language_at_send_check";`);
    this.addSql(`alter table "bank_recovery_delivery" add constraint "bank_recovery_delivery_language_at_send_check" check ("language_at_send" in ('EN', 'ES', 'IT', 'PT'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop constraint "appuser_language_check";`);
    this.addSql(`alter table "appuser" add constraint "appuser_language_check" check ("language" in ('EN', 'ES', 'PT'));`);

    this.addSql(`alter table "bank_recovery_delivery" drop constraint "bank_recovery_delivery_language_at_send_check";`);
    this.addSql(`alter table "bank_recovery_delivery" add constraint "bank_recovery_delivery_language_at_send_check" check ("language_at_send" in ('EN', 'ES', 'PT'));`);
  }

}
