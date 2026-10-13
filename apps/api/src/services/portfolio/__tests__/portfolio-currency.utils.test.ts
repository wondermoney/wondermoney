import { describe, expect, it } from 'vitest';

import {
  getPreferredSnapshotTotalValue,
  resolveHoldingCurrentMetrics,
  resolveHoldingUnitAmount,
} from '../portfolio-currency.utils';

describe('portfolio currency utils', () => {
  it('prefers appuser snapshot total value when available', () => {
    expect(
      getPreferredSnapshotTotalValue({
        appuserCurrencyTotalValue: 120,
        totalValue: 100,
      }),
    ).toBe(120);
  });

  it('falls back to raw snapshot total value when appuser value is absent', () => {
    expect(
      getPreferredSnapshotTotalValue({
        totalValue: 100,
      }),
    ).toBe(100);
  });

  it('prefers appuser unit amount for holding cost basis when available', () => {
    expect(
      resolveHoldingUnitAmount({
        unit_appuser_amount: 120,
        unit_settlement_amount: 112.8,
      }),
    ).toBe(120);
  });

  it('falls back to settlement unit amount when appuser unit amount is absent', () => {
    expect(
      resolveHoldingUnitAmount({
        unit_settlement_amount: 112.8,
      }),
    ).toBe(112.8);
  });

  it('converts non-cash holding prices to target currency', () => {
    expect(
      resolveHoldingCurrentMetrics({
        assetType: 'Stock',
        averageBuyPrice: 120,
        conversionRate: 0.94,
        quantity: 2,
        rawCurrentPrice: 130,
      }),
    ).toMatchObject({
      currentPrice: 122.2,
      currentValue: 244.4,
      unrealizedGains: 4.4,
    });
  });

  it('treats cash holdings as one unit of their currency before conversion', () => {
    expect(
      resolveHoldingCurrentMetrics({
        assetType: 'Cash',
        averageBuyPrice: 1,
        conversionRate: 1.06,
        quantity: 100,
        rawCurrentPrice: null,
      }),
    ).toMatchObject({
      currentPrice: 1.06,
      currentValue: 106,
      unrealizedGains: 6,
    });
  });
});
