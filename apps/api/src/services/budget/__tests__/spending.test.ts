import { describe, expect, it } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';

import { buildBudgetSpendingQuery } from '../spending';

const { db } = kyselyDouble();
const baseInput = {
  accountKeys: [202],
  currency: { code: 'EUR', currencyKey: 1 },
  period: 'monthly' as const,
  periodStartDay: 1,
  templateKeys: [101],
  tenantKey: 17,
  viewerAppuserKey: 42,
};

describe('budget spending query', () => {
  it('preserves separate parent-budget recurrency for monthly and annual reads', () => {
    const monthly = buildBudgetSpendingQuery(db, { ...baseInput, period: 'monthly' }, []).compile(db).sql.toLowerCase();
    const annual = buildBudgetSpendingQuery(db, { ...baseInput, period: 'annual' }, []).compile(db).sql.toLowerCase();

    expect(monthly).toContain('sum(coalesce(child_category_amounts.category_budgeted_amount, 0))');
    expect(monthly).not.toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly' then 12");
    expect(annual).toContain('with "monthly_child_category_data"');
    expect(annual).toContain('sum(category_amount) as "category_amount"');
  });
});
