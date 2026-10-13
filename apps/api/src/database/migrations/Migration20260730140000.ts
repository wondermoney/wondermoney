import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `account.transactions_refreshed_at` (RAD-346, Phase 1 — stale-sync warning).
 * Tracks the last successful *transaction* sync per account, distinct from the account-level
 * `refreshed_at`, so the accounts DTO can derive a user-facing staleness signal. Additive,
 * nullable — zero backfill, zero money risk.
 */
export class Migration20260730140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "account" add column if not exists "transactions_refreshed_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account" drop column if exists "transactions_refreshed_at";`);
  }
}
