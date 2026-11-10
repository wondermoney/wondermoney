import { Migration } from '@mikro-orm/migrations';

/**
 * Cross-currency transfer matching stores the rate a pair settled at: `transaction` gains
 * `transfer_exchange_rate`, set on both rows of a pair across two currencies. One nullable column.
 * Additive only.
 */
export class Migration20261110184900 extends Migration {

  override name = 'Migration20261110184900';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transaction" add "transfer_exchange_rate" numeric(18,8) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction" drop column "transfer_exchange_rate";`);
  }

}
