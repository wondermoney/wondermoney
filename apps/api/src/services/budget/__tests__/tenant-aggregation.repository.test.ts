import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockEm } from '@app/__tests__/__helpers__/mock-em';

import { MikroOrmTenantAggregationRepository } from '../tenant-aggregation.repository';

describe('MikroOrmTenantAggregationRepository', () => {
  const execute = vi.fn();
  const repository = new MikroOrmTenantAggregationRepository(Object.assign(mockEm(), { getConnection: () => ({ execute }) }));

  beforeEach(() => vi.clearAllMocks());

  it('requires the exact active, undeleted membership and active appuser', async () => {
    execute.mockResolvedValue({ present: 1 });
    await expect(repository.hasActiveMembership(7, 11)).resolves.toBe(true);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([7, 11]);
    expect(sql).toContain('membership."record_active" = true and membership."deleted_at" is null');
    expect(sql).toContain('owner."record_active" = true and owner."deleted_at" is null');
  });

  it('keeps budget account rows visible for whole-budget tenant and ownership validation', async () => {
    execute.mockResolvedValue([]);
    await repository.loadBudgetAllocations(7, 7, 2026);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([7, 2026, 7, 7, 7]);
    expect(sql).toContain('left join "account"');
    expect(sql).toContain('template."amount_budgeted" > 0');
    expect(sql).toContain('category."parent_category_category_key" is not null');
  });

  it('uses half-open UTC range predicates and strict tenant/owner/account filters', async () => {
    execute.mockResolvedValue([]);
    const range = { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') };
    await repository.loadTransactions(7, 11, range);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([7, 11, range.start, range.end, 11, 7]);
    expect(sql).toContain('tx."transaction_date" >= ? and tx."transaction_date" < ?');
    expect(sql).toContain('tx."deleted_at" is null');
    expect(sql).toContain('account."closed" = false and account."deleted_at" is null');
  });

  it('normalizes raw timestamp strings and fails closed on invalid timestamps', async () => {
    execute.mockResolvedValue([
      { transactionDate: '2026-07-01T12:00:00.000Z', transactionKey: 1 },
      { transactionDate: 'invalid', transactionKey: 2 },
    ]);
    const rows = await repository.loadTransactions(7, 11, { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') });
    expect(rows[0]?.transactionDate).toEqual(new Date('2026-07-01T12:00:00.000Z'));
    expect(rows[1]?.transactionDate).toBeNull();
  });
});
