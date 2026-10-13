import { describe, expect, it, vi } from 'vitest';

import { mockEm } from '@app/__tests__/__helpers__/mock-em';

import { reserveTransactionEnrichmentBudget } from '../transaction-enrichment-budget.service';

function makeEm(executeResult: unknown = []) {
  const execute = vi.fn().mockResolvedValue(executeResult);
  return { em: Object.assign(mockEm(), { execute }), execute };
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('reserveTransactionEnrichmentBudget', () => {
  it('reserves via a single INSERT ... ON CONFLICT DO UPDATE guarded by the limit', async () => {
    const { em, execute } = makeEm([{ reserved_count: 1 }]);

    const reserved = await reserveTransactionEnrichmentBudget(em, 7, '2026-08-02', 50);

    expect(reserved).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    const normalized = normalize(sql);
    expect(normalized).toContain('insert into "transaction_enrichment_budget"');
    expect(normalized).toContain('on conflict ("tenant_key", "day") do update set "reserved_count" = "transaction_enrichment_budget"."reserved_count" + 1');
    expect(normalized).toContain('where "transaction_enrichment_budget"."reserved_count" < ?');
    expect(normalized).toContain('returning "reserved_count"');
    expect(params).toEqual([7, '2026-08-02', 50]);
  });

  it('returns false when the guarded update returns no row (budget exhausted)', async () => {
    const { em } = makeEm([]);

    const reserved = await reserveTransactionEnrichmentBudget(em, 7, '2026-08-02', 50);

    expect(reserved).toBe(false);
  });

  it('does not touch the database when the limit is zero or negative', async () => {
    const { em, execute } = makeEm([{ reserved_count: 1 }]);

    expect(await reserveTransactionEnrichmentBudget(em, 7, '2026-08-02', 0)).toBe(false);
    expect(await reserveTransactionEnrichmentBudget(em, 7, '2026-08-02', -5)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
