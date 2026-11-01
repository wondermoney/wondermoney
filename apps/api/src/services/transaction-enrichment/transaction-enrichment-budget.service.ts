import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Atomically reserve one unit of the per-tenant, per-day transaction-enrichment budget.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE ... WHERE reserved_count < :limit RETURNING` makes the
 * check-and-increment race-safe under concurrent workers:
 * - No row yet → the INSERT lands `reserved_count = 1` and RETURNING yields the row (reserved).
 *   A fresh insert is only allowed when `limit >= 1`, which the early return below guarantees.
 * - Row exists and `reserved_count < limit` → the UPDATE increments and RETURNING yields the row.
 * - Row exists and `reserved_count >= limit` → the WHERE blocks the UPDATE, RETURNING is empty
 *   (budget exhausted).
 *
 * Returns true when a unit was reserved, false when the budget is exhausted (or disabled via a
 * non-positive limit). `day` is the UTC calendar day as a `YYYY-MM-DD` string.
 */
export async function reserveTransactionEnrichmentBudget(
  em: EntityManager,
  tenantKey: number,
  day: string,
  limit: number,
): Promise<boolean> {
  if (!Number.isFinite(limit) || limit <= 0) return false;

  const rows = await em.execute(
    `insert into "transaction_enrichment_budget"
       ("created_at", "updated_at", "tenant_key", "day", "reserved_count")
     values (now(), now(), ?, ?, 1)
     on conflict ("tenant_key", "day")
     do update set "reserved_count" = "transaction_enrichment_budget"."reserved_count" + 1, "updated_at" = now()
       where "transaction_enrichment_budget"."reserved_count" < ?
     returning "reserved_count"`,
    [tenantKey, day, limit],
  );

  return Array.isArray(rows) && rows.length > 0;
}
