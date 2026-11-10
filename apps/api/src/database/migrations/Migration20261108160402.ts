import { Migration } from '@mikro-orm/migrations';

/**
 * A portfolio's optional link to the account that holds it, and whether that account's balance
 * already includes the holdings, so net worth does not count the same money twice. Additive and
 * nullable: every existing portfolio stays unlinked and counts as before.
 */
export class Migration20261108160402 extends Migration {

  override name = 'Migration20261108160402';

  override up(): void | Promise<void> {
    this.addSql(`alter table "portfolio" add "account_balance_mode" text null, add "linked_account_key" int null;`);
    this.addSql(`alter table "portfolio" add constraint "portfolio_linked_account_key_foreign" foreign key ("linked_account_key") references "account" ("account_key") on delete set null;`);
    this.addSql(`alter table "portfolio" add constraint "portfolio_account_balance_mode_check" check ("account_balance_mode" in ('cash_only', 'includes_holdings'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "portfolio" drop constraint "portfolio_linked_account_key_foreign";`);

    this.addSql(`alter table "portfolio" drop constraint "portfolio_account_balance_mode_check";`);
    this.addSql(`alter table "portfolio" drop column "account_balance_mode", drop column "linked_account_key";`);
  }

}
