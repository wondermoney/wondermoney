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

/*
 * An amount edit writes the account-currency value to `editedSettlementAmount` and the
 * converted value to `appuserSettlementAmount`. User-currency aggregates must read the
 * latter: a GBP account edited to -40 GBP is -46 in a EUR user's totals, not -40.
 */
describe('account edited amount helpers', () => {
  it('counts a foreign-currency edit in the user currency', () => {
    expect(
      getEffectiveAppuserAmount({
        appuserSettlementAmount: -46,
        editedSettlementAmount: -40,
      }),
    ).toBe(-46);
  });

  it('uses the user-currency amount of an unedited transaction', () => {
    expect(
      getEffectiveAppuserAmount({
        appuserSettlementAmount: -100,
      }),
    ).toBe(-100);
  });

  it('returns only positive effective amounts for inflow calculations', () => {
    expect(getPositiveEffectiveAppuserAmount({ appuserSettlementAmount: 46, editedSettlementAmount: 40 })).toBe(46);
    expect(getPositiveEffectiveAppuserAmount({ appuserSettlementAmount: -46, editedSettlementAmount: -40 })).toBe(0);
  });

  it('returns only negative effective amounts for outflow calculations', () => {
    expect(getNegativeEffectiveAppuserAmount({ appuserSettlementAmount: -46, editedSettlementAmount: -40 })).toBe(-46);
    expect(getNegativeEffectiveAppuserAmount({ appuserSettlementAmount: 46, editedSettlementAmount: 40 })).toBe(0);
  });

  it('never sums the account-currency edited column in SQL aggregates', () => {
    expect(buildEffectiveAmountSql('t')).toContain('t.appuser_settlement_amount');
    expect(buildEffectiveAmountSql('t')).not.toContain('edited_settlement_amount');
    expect(buildEffectiveSpendingAmountSql('t', 'crl')).not.toContain('edited_settlement_amount');
  });

  it('builds category spending totals in the user currency', () => {
    const categorySpending = mapCategorySpendingByName([
      {
        appuserCurrencyCode: 'EUR',
        appuserSettlementAmount: -46,
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

    expect(categorySpending[0]).toMatchObject({ amount: 46, name: 'Food', numTransactions: 1 });
  });

  it('filters out transactions that are no longer expenses after editing', () => {
    const filtered = filterExpenseTransactions([
      { appuserSettlementAmount: 20, editedSettlementAmount: 20 },
      { appuserSettlementAmount: -10, editedSettlementAmount: -10 },
    ]);

    expect(filtered).toHaveLength(1);
    expect(getEffectiveAppuserAmount(filtered[0]!)).toBe(-10);
  });
});
