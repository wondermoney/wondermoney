import { describe, expect, it } from 'vitest';

import {
  buildEffectiveAmountSql,
  buildEffectiveSpendingAmountSql,
  filterExpenseTransactions,
  getEffectiveAppuserAmount,
  getNegativeEffectiveAppuserAmount,
  getPositiveEffectiveAppuserAmount,
  mapCategorySpendingByName,
} from '../../utils/account-amounts';

describe('account edited amount helpers', () => {
  it('uses edited settlement amount when present', () => {
    expect(
      getEffectiveAppuserAmount({
        appuserSettlementAmount: -100,
        editedSettlementAmount: -40,
      }),
    ).toBe(-40);
  });

  it('falls back to appuser settlement amount when edited amount is absent', () => {
    expect(
      getEffectiveAppuserAmount({
        appuserSettlementAmount: -100,
      }),
    ).toBe(-100);
  });

  it('returns only positive effective amounts for inflow calculations', () => {
    expect(
      getPositiveEffectiveAppuserAmount({
        appuserSettlementAmount: 100,
        editedSettlementAmount: 40,
      }),
    ).toBe(40);

    expect(
      getPositiveEffectiveAppuserAmount({
        appuserSettlementAmount: -100,
        editedSettlementAmount: -40,
      }),
    ).toBe(0);
  });

  it('returns only negative effective amounts for outflow calculations', () => {
    expect(
      getNegativeEffectiveAppuserAmount({
        appuserSettlementAmount: -100,
        editedSettlementAmount: -40,
      }),
    ).toBe(-40);

    expect(
      getNegativeEffectiveAppuserAmount({
        appuserSettlementAmount: 100,
        editedSettlementAmount: 40,
      }),
    ).toBe(0);
  });

  it('builds SQL using edited settlement amount as the first choice', () => {
    expect(buildEffectiveAmountSql('t')).toBe('COALESCE(t.edited_settlement_amount, t.appuser_settlement_amount)');
  });

  it('builds loan-aware spending SQL for budget and spending aggregates', () => {
    expect(buildEffectiveSpendingAmountSql('t', 'crl')).toBe(
      'CASE WHEN crl.loan_repayment_link_key IS NULL THEN COALESCE(t.edited_settlement_amount, t.appuser_settlement_amount) ELSE COALESCE(crl.interest_amount, 0) + COALESCE(crl.fee_amount, 0) END',
    );
  });

  it('builds category spending totals from the effective amount', () => {
    const categorySpending = mapCategorySpendingByName([
      {
        appuserCurrencyCode: 'EUR',
        appuserSettlementAmount: -100,
        category: {
          bgColor: '#111111',
          categoryKey: 1,
          icon: 'fork-knife',
          isSystemCategory: true,
          name: 'Food',
          parentCategory: null,
          textColor: '#ffffff',
        },
        editedSettlementAmount: -40,
      },
    ]);

    expect(categorySpending[0]).toMatchObject({
      amount: 40,
      name: 'Food',
      numTransactions: 1,
    });
  });

  it('filters out transactions that are no longer expenses after editing', () => {
    const filtered = filterExpenseTransactions([
      {
        appuserSettlementAmount: -100,
        editedSettlementAmount: 20,
      },
      {
        appuserSettlementAmount: -50,
        editedSettlementAmount: -10,
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(getEffectiveAppuserAmount(filtered[0]!)).toBe(-10);
  });
});
