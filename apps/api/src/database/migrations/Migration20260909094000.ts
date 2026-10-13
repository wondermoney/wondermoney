import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the nullable `enable_banking_transaction_id` column to `transaction`
 * (Phase 1a, plan §2), alongside the existing `nordigen_internal_transaction_id`
 * — not replacing it. Unique with `account_key`, matching the exact
 * constraint shape already used for the Nordigen dedup column
 * (`transaction_account_key_nordigen_internal_transaction_id_unique`).
 *
 * Purely additive: `nordigen_internal_transaction_id` and its constraint are
 * untouched, and the ~300-line dedup logic in
 * `account-initial-sync-transaction.service.ts` is unaffected — this column
 * simply isn't written to until the Enable Banking sync path lands.
 */
export class Migration20260909094000 extends Migration {
  override async down(): Promise<void> {
    this.addSql('alter table "transaction" drop constraint "transaction_account_key_enable_banking_transaction_id_unique";');
    this.addSql('alter table "transaction" drop column "enable_banking_transaction_id";');
  }

  override async up(): Promise<void> {
    this.addSql('alter table "transaction" add column "enable_banking_transaction_id" varchar(255) null;');
    this.addSql(
      'alter table "transaction" add constraint "transaction_account_key_enable_banking_transaction_id_unique" unique ("account_key", "enable_banking_transaction_id");',
    );
  }
}
