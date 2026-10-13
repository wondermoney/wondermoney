import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-346 Phase 4 (ghost-pending expiry) — transaction_status EXPIRED row.
 *
 * Originally this migration inserted the `EXPIRED` row directly. That violated
 * the `src/database/AGENTS.md` rule "Migration files describe schema changes
 * only. Put inserts, updates, deletes, and bootstrap records in seeders." and
 * caused `migrate:dev:fresh` against an empty DB to fail with a unique-key
 * collision when `TransactionStatusSeeder` then tried to insert the same row
 * (RAD-408).
 *
 * The row is now seeded by `TransactionStatusSeeder`, which is idempotent
 * (skips existing rows). This migration is kept as a no-op so the migration
 * history remains consistent for environments that already applied it.
 */
export class Migration20260731000000 extends Migration {
  override async up(): Promise<void> {
    // No-op: bootstrap data lives in `TransactionStatusSeeder`.
  }

  override async down(): Promise<void> {
    // No-op: see `up()`.
  }
}
