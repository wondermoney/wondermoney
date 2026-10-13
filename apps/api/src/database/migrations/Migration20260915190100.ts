import { Migration } from '@mikro-orm/migrations';

/**
 * Index the tenant-scoped read paths, and drop six indexes that are pure write overhead.
 *
 * ## The gap
 *
 * `Transaction`, `Account` and `FinancialTransaction` each carry a `@Filter` that emits
 * `tenant_key = ?` on every authenticated read, yet none had an index whose leading column
 * is `tenant_key`. `entity/Transaction.ts` explicitly decorates `accountKey` and
 * `appuserKey` with `@Index()` and leaves `tenantKey` bare, which reads as an oversight
 * rather than a decision — MikroORM's Postgres schema generator does not create FK indexes
 * automatically, so only explicitly-decorated columns got one.
 *
 * Every tenant-scoped query therefore scans via `account_key`/`appuser_key` and filters
 * `tenant_key` as a residual. That works while tenants are small and degrades as households
 * accumulate history.
 *
 * ## Why these are partial indexes
 *
 * Every entity extends `Base` with a `deletedAt` column and effectively every read is
 * `WHERE deleted_at IS NULL`, so a partial index is both smaller and a better match for the
 * actual predicate.
 *
 * ## CONCURRENTLY
 *
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, hence the `isTransactional()`
 * override — the same pattern `Migration20260523154500` already uses. The cost is that a
 * failure part-way leaves an INVALID index behind, which must be dropped and recreated
 * rather than retried blindly. `IF NOT EXISTS` makes a re-run safe.
 */
export class Migration20260915190100 extends Migration {
  override async down(): Promise<void> {
    this.addSql(`drop index concurrently if exists "transaction_tenant_date_key_idx";`);
    this.addSql(`drop index concurrently if exists "transaction_account_date_active_idx";`);
    this.addSql(`drop index concurrently if exists "account_tenant_key_idx";`);
    this.addSql(`drop index concurrently if exists "financial_transaction_tenant_date_idx";`);
    this.addSql(`drop index concurrently if exists "atc_transaction_key_idx";`);
    this.addSql(`drop index concurrently if exists "appuser_tenant_appuser_active_idx";`);
    this.addSql(`drop index concurrently if exists "financial_asset_price_asset_date_desc_idx";`);

    // Recreate the indexes dropped in up(). Non-concurrently is acceptable on the
    // rollback path: it is an exceptional operation, and these are the small ones.
    this.addSql(`create index if not exists "transaction_account_key_index" on "transaction" ("account_key");`);
    this.addSql(`create index if not exists "transaction_appuser_key_index" on "transaction" ("appuser_key");`);
    this.addSql(`create index if not exists "account_account_owner_appuser_key_index" on "account" ("account_owner_appuser_key");`);
    this.addSql(`create index if not exists "recurring_series_tenant_key_index" on "recurring_series" ("tenant_key");`);
    this.addSql(`create index if not exists "budget_template_category_budget_key_index" on "budget_template_category" ("budget_key");`);
    this.addSql(`create index if not exists "portfolio_snapshot_portfolio_key_snapshot_date_index" on "portfolio_snapshot" ("portfolio_key", "snapshot_date" desc);`);
  }

  /** CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction. */
  override isTransactional(): boolean {
    return false;
  }

  override async up(): Promise<void> {
    // --- Missing tenant-leading indexes on the three largest filtered tables ---

    // Matches the transaction list query exactly: tenant filter + date range + the
    // documented `ORDER BY transactionDate DESC, transactionKey DESC`. The trailing key
    // also makes the keyset cursor an index-only walk.
    this.addSql(`create index concurrently if not exists "transaction_tenant_date_key_idx"
      on "transaction" ("tenant_key", "transaction_date" desc, "transaction_key" desc)
      where "deleted_at" is null;`);

    // The per-account hot path, as a partial index (the existing non-partial composite
    // still carries soft-deleted rows).
    this.addSql(`create index concurrently if not exists "transaction_account_date_active_idx"
      on "transaction" ("account_key", "transaction_date" desc, "transaction_key" desc)
      where "deleted_at" is null;`);

    this.addSql(`create index concurrently if not exists "account_tenant_key_idx"
      on "account" ("tenant_key") where "deleted_at" is null;`);

    this.addSql(`create index concurrently if not exists "financial_transaction_tenant_date_idx"
      on "financial_transaction" ("tenant_key", "transaction_date" desc)
      where "deleted_at" is null;`);

    // FK with no index at all, hit by every category rollup and every transaction delete.
    this.addSql(`create index concurrently if not exists "atc_transaction_key_idx"
      on "appuser_transaction_category" ("transaction_key") where "deleted_at" is null;`);

    // `appuser_tenant` is on the auth hot path — every authenticated request resolves the
    // tenant through it — and had nothing beyond its primary key.
    this.addSql(`create index concurrently if not exists "appuser_tenant_appuser_active_idx"
      on "appuser_tenant" ("appuser_key", "record_active") where "deleted_at" is null;`);

    // Supports the per-holding "latest price" lookup (DISTINCT ON / ORDER BY date DESC).
    this.addSql(`create index concurrently if not exists "financial_asset_price_asset_date_desc_idx"
      on "financial_asset_price" ("financial_asset_key", "date" desc);`);

    // --- Redundant indexes: each is fully covered by another index's prefix ---
    // These cost write throughput and bloat on the highest-write tables for nothing.

    // Covered by transaction_account_key_transaction_date_index.
    this.addSql(`drop index concurrently if exists "transaction_account_key_index";`);
    // Covered by transaction_appuser_key_transaction_date_index.
    this.addSql(`drop index concurrently if exists "transaction_appuser_key_index";`);
    // Covered by account_account_owner_appuser_key_deleted_at_index.
    this.addSql(`drop index concurrently if exists "account_account_owner_appuser_key_index";`);
    // Covered by recurring_series_tenant_status_next_expected_at_index.
    this.addSql(`drop index concurrently if exists "recurring_series_tenant_key_index";`);
    // Covered by budget_template_category_budget_key_year_month_index.
    this.addSql(`drop index concurrently if exists "budget_template_category_budget_key_index";`);
    // Exact duplicate of portfolio_snapshot_portfolio_key_snapshot_date_unique. The DESC is
    // irrelevant — Postgres can scan a btree in either direction.
    this.addSql(`drop index concurrently if exists "portfolio_snapshot_portfolio_key_snapshot_date_index";`);
  }
}
