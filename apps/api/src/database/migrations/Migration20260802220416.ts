import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-342 G4 — scope `transaction_category_stats` per user.
 *
 * A tenant is now a household of up to two members (RAD-343). Stats were keyed only on
 * (merchant, category, source), so both members shared — and contaminated — each other's
 * merchant→category vote counts. This adds a nullable `appuser_key` dimension and widens the
 * unique constraint to include it, so each member's votes stay their own. `appuser_key` is
 * nullable because rows written before this migration predate the dimension; a follow-up backfill
 * attributes those to the tenant owner. All new writes set it.
 */
export class Migration20260802220416 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "transaction_category_stats" drop constraint "transaction_category_stats_transaction_merchant_k_bffc3_unique";');
    this.addSql('alter table "transaction_category_stats" add column "appuser_key" int null;');
    this.addSql('alter table "transaction_category_stats" add constraint "transaction_category_stats_appuser_key_foreign" foreign key ("appuser_key") references "appuser" ("appuser_key") on delete set null;');
    this.addSql('alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_k_7b74f_unique" unique ("transaction_merchant_key", "category_key", "source", "appuser_key");');
  }

  // NOTE: once per-user traffic exists, the table legitimately holds multiple rows that share
  // (merchant, category, source) and differ only by appuser_key. Re-adding the old 3-column unique
  // below will then fail on those duplicates — so this down() is only clean on a table that has had
  // no G4 writes. A production rollback after traffic needs a forward-fix (dedupe first), not down().
  override async down(): Promise<void> {
    this.addSql('alter table "transaction_category_stats" drop constraint "transaction_category_stats_transaction_merchant_k_7b74f_unique";');
    this.addSql('alter table "transaction_category_stats" drop constraint "transaction_category_stats_appuser_key_foreign";');
    this.addSql('alter table "transaction_category_stats" drop column "appuser_key";');
    this.addSql('alter table "transaction_category_stats" add constraint "transaction_category_stats_transaction_merchant_k_bffc3_unique" unique ("transaction_merchant_key", "category_key", "source");');
  }
}
