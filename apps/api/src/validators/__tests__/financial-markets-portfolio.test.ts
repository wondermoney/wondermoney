import { describe, expect, it } from 'vitest';

import { confirmPortfolioImportAssetMappingsRequestSchema, createPortfolioTransactionRequestSchema, updatePortfolioRequestSchema } from '../portfolio';

describe('financial markets and portfolio validators', () => {
  it.each([
    '=EURUSD',
    'EURUSD=X',
    'EUR USD=X',
    'EURUSD=X\nINJECT',
    'EURUSD=X?token=secret',
    '../EURUSD=X',
    '/EURUSD=X',
  ])('rejects unsafe external symbol %j', (symbol) => {
    expect(confirmPortfolioImportAssetMappingsRequestSchema.safeParse({
      body: { decisions: [{ action: 'use_external_symbol', groupId: 4, symbol }] },
      params: { importSessionId: 19 },
    }).success).toBe(false);
  });

  it('parses portfolio payloads into concrete types', () => {
    expect(
      createPortfolioTransactionRequestSchema.parse({
        body: {
          assetSymbol: 'AAPL',
          financialTransactionTypeId: '7',
          quantity: '2.5',
          settlementCurrencyId: '1',
          transactionDate: '2026-06-04',
          unitPrice: '190.25',
        },
        params: { portfolioId: '42' },
      }),
    ).toEqual({
      body: {
        assetSymbol: 'AAPL',
        financialTransactionTypeId: 7,
        quantity: 2.5,
        settlementCurrencyId: 1,
        taxExempt: false,
        transactionDate: new Date('2026-06-04'),
        unitPrice: 190.25,
      },
      params: { portfolioId: 42 },
    });
  });

  it('parses portfolio updates with concrete optional fields', () => {
    expect(
      updatePortfolioRequestSchema.parse({
        body: {
          currencyId: '2',
          description: null,
          excluded: true,
          favored: false,
          name: 'Long-term',
          targetAllocation: { Stocks: 80 },
        },
        params: { portfolioId: '10' },
      }),
    ).toEqual({
      body: {
        currencyId: 2,
        description: null,
        excluded: true,
        favored: false,
        name: 'Long-term',
        targetAllocation: { Stocks: 80 },
      },
      params: { portfolioId: 10 },
    });
  });
});
