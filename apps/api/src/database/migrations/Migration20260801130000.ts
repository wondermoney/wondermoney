import { Migration } from '@mikro-orm/migrations';

/**
 * RAD-343 (A2) — backfill `financial_transaction.tenant_key` for legacy rows.
 *
 * FinancialTransaction is now tenant-scoped by the global tenant filter
 * (strict `tenantScopedCond`). Legacy rows may have a NULL tenant, which the
 * strict filter would hide from every request. Backfill the tenant from the
 * row's portfolio (authoritative — Portfolio.tenant_key is NOT NULL), falling
 * back to the owning appuser's active tenant.
 *
 * Data-only backfill (see A1 migration note): seeders don't run in prod, so the
 * backfill lives here. `down` is a no-op — we can't distinguish backfilled rows
 * from rows that were always tenant-tagged, and re-nulling them would be wrong.
 */
export class Migration20260801130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "financial_transaction" ft set "tenant_key" = coalesce(` +
        `(select p."tenant_key" from "portfolio" p where p."portfolio_key" = ft."portfolio_key"),` +
        `(select at."tenant_key" from "appuser_tenant" at where at."appuser_key" = ft."appuser_key" and at."record_active" = true order by at."appuser_tenant_key" limit 1)` +
        `) where ft."tenant_key" is null;`,
    );
  }

  override async down(): Promise<void> {
    // Intentional no-op: the backfill is not safely reversible.
  }
}
