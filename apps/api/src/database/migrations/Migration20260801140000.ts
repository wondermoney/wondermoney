import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-343 (A2) — backfill `transaction.tenant_key` for legacy rows.
 *
 * Transaction is now tenant-scoped by the global tenant filter. Historically
 * transactions were scoped by `appuser_key` and many rows have a NULL tenant,
 * which the filter would hide from every request. Backfill the tenant from the
 * row's account (authoritative — Account.tenant_key is NOT NULL), falling back
 * to the owning appuser's active tenant.
 *
 * OPERATIONAL NOTE: `transaction` is the largest table. In production this
 * single UPDATE may need to run batched / in a maintenance window to avoid a
 * long lock. Correctness-wise the statement is idempotent (only touches NULLs).
 *
 * Data-only backfill (see A1 note). `down` is a no-op — not safely reversible.
 */
export class Migration20260801140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "transaction" t set "tenant_key" = coalesce(` +
        `(select a."tenant_key" from "account" a where a."account_key" = t."account_key"),` +
        `(select at."tenant_key" from "appuser_tenant" at where at."appuser_key" = t."appuser_key" and at."record_active" = true order by at."appuser_tenant_key" limit 1)` +
        `) where t."tenant_key" is null;`,
    );
  }

  override async down(): Promise<void> {
    // Intentional no-op: the backfill is not safely reversible.
  }
}
