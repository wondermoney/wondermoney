import { describe, expect, it } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';

import { buildBudgetSpendingQuery } from '../spending';

const { db } = kyselyDouble();
const baseInput = {
  accountKeys: [202],
  period: 'monthly' as const,
  templateKeys: [101],
  tenantKey: 17,
  viewerAppuserKey: 42,
};

describe('budget spending query', () => {
  it('keeps transaction visibility in the LEFT JOIN and scopes tenant/private accounts', () => {
    const compiled = buildBudgetSpendingQuery(db, { ...baseInput, period: 'monthly' }).compile(db);
    const bindings = compiled.parameters;
    const sql = compiled.sql.toLowerCase();
    const transactionJoin = sql.slice(sql.indexOf('left join "transaction"'), sql.indexOf('left join "loan_repayment_link"'));

    expect(transactionJoin).toContain('"transaction"."deleted_at" is null');
    expect(transactionJoin).toContain('"appuser_transaction_category"."deleted_at" is null');
    expect(transactionJoin).toMatch(/"transaction"\."tenant_key" = \$\d+/);
    expect(transactionJoin).toMatch(/budget_account\.tenant_key = \$\d+/);
    expect(transactionJoin).toContain('budget_account.closed = false');
    expect(transactionJoin).toContain('budget_account.deleted_at is null');
    expect(transactionJoin).toMatch(/\(budget_account\.is_private = false or budget_account\.account_owner_appuser_key = \$\d+\)/);
    expect(sql).toContain('left join "appuser_transaction_category"');
    expect(sql).toContain('coalesce(category_budgeted_amount, 0) as category_budgeted_amount');
    expect(sql).toContain('union all');
    expect(bindings).toContain(17);
    expect(bindings).toContain(42);
    // The first WHERE after the transaction join: the join's own predicates may hold subqueries.
    expect(sql.slice(sql.indexOf('where ', sql.indexOf('left join "loan_repayment_link"')))).not.toContain('"transaction"."tenant_key"');
  });

  it('preserves separate parent-budget recurrency for monthly and annual reads', () => {
    const monthly = buildBudgetSpendingQuery(db, { ...baseInput, period: 'monthly' }).compile(db).sql.toLowerCase();
    const annual = buildBudgetSpendingQuery(db, { ...baseInput, period: 'annual' }).compile(db).sql.toLowerCase();

    expect(monthly).toContain('sum(coalesce(child_category_amounts.category_budgeted_amount, 0))');
    expect(monthly).not.toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly' then 12");
    expect(annual).toContain('with "monthly_child_category_data"');
    expect(annual).toContain('sum(category_amount) as "category_amount"');
  });
});
