import { Migration } from '@mikro-orm/migrations';

/**
 * Money that is not spending. `category.counts_as_spending` (on by default; the "Investments and
 * savings" system category, seeded by `InvestmentsAndSavingsCategorySeeder`, has it off), and where
 * an outgoing transfer a user marked went: another account, a portfolio or a goal, at most one.
 */
export class Migration20261108163525 extends Migration {

  override name = 'Migration20261108163525';

  override up(): void | Promise<void> {
    this.addSql(`alter table "category" add "counts_as_spending" boolean not null default true;`);

    this.addSql(`alter table "transaction" add "transfer_destination_account_key" int null, add "transfer_destination_goal_key" int null, add "transfer_destination_portfolio_key" int null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_transfer_destination_account_key_foreign" foreign key ("transfer_destination_account_key") references "account" ("account_key") on delete set null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_transfer_destination_goal_key_foreign" foreign key ("transfer_destination_goal_key") references "goal" ("goal_key") on delete set null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_transfer_destination_portfolio_key_foreign" foreign key ("transfer_destination_portfolio_key") references "portfolio" ("portfolio_key") on delete set null;`);
    this.addSql(`alter table "transaction" add constraint "transaction_transfer_destination_single_check" check (num_nonnulls("transfer_destination_account_key", "transfer_destination_portfolio_key", "transfer_destination_goal_key") <= 1);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transaction" drop constraint "transaction_transfer_destination_account_key_foreign";`);
    this.addSql(`alter table "transaction" drop constraint "transaction_transfer_destination_goal_key_foreign";`);
    this.addSql(`alter table "transaction" drop constraint "transaction_transfer_destination_portfolio_key_foreign";`);

    this.addSql(`alter table "category" drop column "counts_as_spending";`);

    this.addSql(`alter table "transaction" drop constraint "transaction_transfer_destination_single_check";`);
    this.addSql(`alter table "transaction" drop column "transfer_destination_account_key", drop column "transfer_destination_goal_key", drop column "transfer_destination_portfolio_key";`);
  }

}
