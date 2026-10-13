import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the debt-paydown goal type to `goal`: a `type` discriminator (defaulting existing
 * rows to 'save_up') plus nullable debt fields (current balance, interest rate in bps,
 * minimum/extra payment) and an optional link to a `credit_facility`.
 */
export class Migration20260730000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "goal" add column "type" text not null default 'save_up' check ("type" in ('save_up', 'debt_paydown'));`);
    this.addSql(`alter table "goal" add column "current_balance" numeric(18, 4) null;`);
    this.addSql(`alter table "goal" add column "annual_interest_rate_bps" int null;`);
    this.addSql(`alter table "goal" add column "minimum_payment" numeric(18, 4) null;`);
    this.addSql(`alter table "goal" add column "extra_payment" numeric(18, 4) null;`);
    this.addSql(`alter table "goal" add column "credit_facility_key" int null;`);
    this.addSql(`alter table "goal" add constraint "goal_credit_facility_key_foreign" foreign key ("credit_facility_key") references "credit_facility" ("credit_facility_key") on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "goal" drop constraint if exists "goal_credit_facility_key_foreign";`);
    this.addSql(`alter table "goal" drop column if exists "credit_facility_key";`);
    this.addSql(`alter table "goal" drop column if exists "extra_payment";`);
    this.addSql(`alter table "goal" drop column if exists "minimum_payment";`);
    this.addSql(`alter table "goal" drop column if exists "annual_interest_rate_bps";`);
    this.addSql(`alter table "goal" drop column if exists "current_balance";`);
    this.addSql(`alter table "goal" drop column if exists "type";`);
  }

}
