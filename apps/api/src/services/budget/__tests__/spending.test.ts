import knex from 'knex';
import { describe, expect, it } from 'vitest';

import { buildBudgetSpendingQuery } from '../spending';

const queryKnex = knex({ client: 'pg' });
const baseInput = {
  accountKeys: [202],
  period: 'monthly' as const,
  templateKeys: [101],
  tenantKey: 17,
  viewerAppuserKey: 42,
};

describe('budget spending query', () => {
  it('keeps transaction visibility in the LEFT JOIN and scopes tenant/private accounts', () => {
    const compiled = buildBudgetSpendingQuery(queryKnex, { ...baseInput, period: 'monthly' }).toSQL();
    const { bindings } = compiled;
    const sql = compiled.sql.toLowerCase();
    const transactionJoin = sql.slice(sql.indexOf('left join "transaction"'), sql.indexOf('left join "loan_repayment_link"'));

    expect(transactionJoin).toContain('"transaction"."deleted_at" is null');
    expect(transactionJoin).toContain('"appuser_transaction_category"."deleted_at" is null');
    expect(transactionJoin).toContain('"transaction"."tenant_key" = ?');
    expect(transactionJoin).toContain('budget_account.tenant_key = ?');
    expect(transactionJoin).toContain('budget_account.closed = false');
    expect(transactionJoin).toContain('budget_account.deleted_at is null');
    expect(transactionJoin).toContain('(budget_account.is_private = false or budget_account.account_owner_appuser_key = ?)');
    expect(sql).toContain('left join "appuser_transaction_category"');
    expect(sql).toContain('abs(sum(coalesce(');
    expect(sql).toContain('coalesce(category_budgeted_amount, 0) as category_budgeted_amount');
    expect(sql).toContain('union all');
    expect(bindings).toContain(17);
    expect(bindings).toContain(42);
    expect(sql.slice(sql.indexOf('where '))).not.toContain('"transaction"."tenant_key"');
  });

  it('preserves separate parent-budget recurrency for monthly and annual reads', () => {
    const monthly = buildBudgetSpendingQuery(queryKnex, { ...baseInput, period: 'monthly' }).toSQL().sql.toLowerCase();
    const annual = buildBudgetSpendingQuery(queryKnex, { ...baseInput, period: 'annual' }).toSQL().sql.toLowerCase();

    expect(monthly).toContain('sum(coalesce(child_category_amounts.category_budgeted_amount, 0))');
    expect(monthly).not.toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly_14' then 14");
    expect(annual).toContain("when 'monthly' then 12");
    expect(annual).toContain('with "monthly_child_category_data"');
    expect(annual).toContain('sum(category_amount) as category_amount');
  });
});
