import { Migration } from '@mikro-orm/migrations';

/**
 * What an account held before its first transaction, so net worth history can count an account
 * that has no transactions. `migrate.ts` fills it for existing accounts after the migrations
 * (`backfillAccountOpeningBalances`).
 */
export class Migration20261107100000 extends Migration {

  override name = 'Migration20261107100000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "account" add "opening_balance" numeric(18, 4) null, add "opening_balance_date" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "account" drop column "opening_balance", drop column "opening_balance_date";`);
  }

}
