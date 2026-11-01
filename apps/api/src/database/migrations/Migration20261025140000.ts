import { Migration } from '@mikro-orm/migrations';

/**
 * Drops the unique index on `(account_key, internal_transaction_id)`. That id is a fingerprint of
 * the date and amount, so two real transactions on the same day for the same amount share it: the
 * index made the bank sync skip the second one and rejected a second identical manual entry.
 * Duplicates are prevented by the provider-id constraints instead. Databases that never got the
 * index are unaffected.
 */
export class Migration20261025140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index if exists "transaction_account_key_internal_transaction_id_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`create unique index if not exists "transaction_account_key_internal_transaction_id_unique" on "transaction" ("account_key", "internal_transaction_id") where "deleted_at" is null;`);
  }
}
