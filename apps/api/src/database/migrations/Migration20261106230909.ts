import { Migration } from '@mikro-orm/migrations';

/**
 * `fx_status` on accounts and transactions: how the stored user-currency amount was converted
 * (`exact`, `provisional`, or `missing` when no rate exists and no converted amount is stored).
 * Nullable with no default: rows written before it stay unstamped until they are restamped.
 */
export class Migration20261106230909 extends Migration {

  override name = 'Migration20261106230909';

  override up(): void | Promise<void> {
    this.addSql(`alter table "account" add "fx_status" text null;`);
    this.addSql(`alter table "account" add constraint "account_fx_status_check" check ("fx_status" in ('exact', 'missing', 'provisional'));`);

    this.addSql(`alter table "transaction" add "fx_status" text null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_fx_status_check" check ("fx_status" in ('exact', 'missing', 'provisional'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "account" drop constraint "account_fx_status_check";`);
    this.addSql(`alter table "account" drop column "fx_status";`);

    this.addSql(`alter table "transaction" drop constraint "transaction_fx_status_check";`);
    this.addSql(`alter table "transaction" drop column "fx_status";`);
  }

}
