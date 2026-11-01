import { describe, expect, it } from 'vitest';

import { createOfflineAccountRequestSchema, getTransactionMerchantsRequestSchema, transactionOCRModelOutputSchema } from '../account';

describe('createOfflineAccountRequestSchema', () => {
  const baseBody = { currencyId: 1, currentBalance: 100, name: 'Cash' };

  it('accepts a request without accountTypeId, leaving it undefined', () => {
    const parsed = createOfflineAccountRequestSchema.parse({ body: baseBody });

    expect(parsed.body.accountTypeId).toBeUndefined();
  });

  it('accepts and coerces a numeric-string accountTypeId', () => {
    const parsed = createOfflineAccountRequestSchema.parse({
      body: { ...baseBody, accountTypeId: '3' },
    });

    expect(parsed.body.accountTypeId).toBe(3);
  });

  it('accepts a numeric accountTypeId', () => {
    const parsed = createOfflineAccountRequestSchema.parse({
      body: { ...baseBody, accountTypeId: 3 },
    });

    expect(parsed.body.accountTypeId).toBe(3);
  });

  it('rejects a non-positive-integer accountTypeId', () => {
    expect(() =>
      createOfflineAccountRequestSchema.parse({
        body: { ...baseBody, accountTypeId: 0 },
      }),
    ).toThrow();

    expect(() =>
      createOfflineAccountRequestSchema.parse({
        body: { ...baseBody, accountTypeId: -1 },
      }),
    ).toThrow();

    expect(() =>
      createOfflineAccountRequestSchema.parse({
        body: { ...baseBody, accountTypeId: 'not-a-number' },
      }),
    ).toThrow();
  });
});

describe('getTransactionMerchantsRequestSchema', () => {
  it('defaults and trims merchant search params', () => {
    const parsed = getTransactionMerchantsRequestSchema.parse({
      query: { search: '  Café   Central  ' },
    });

    expect(parsed.query).toEqual({
      limit: 20,
      search: 'Café   Central',
    });
  });

  it('bounds the merchant search limit at fifty', () => {
    expect(() =>
      getTransactionMerchantsRequestSchema.parse({
        query: { limit: '51' },
      }),
    ).toThrow();

    expect(
      getTransactionMerchantsRequestSchema.parse({
        query: { limit: '50' },
      }).query.limit,
    ).toBe(50);
  });
});

describe('transaction OCR model output schema', () => {
  it('accepts valid OCR output', () => {
    expect(
      transactionOCRModelOutputSchema.parse({
        settlementAmount: 12.34,
        settlementCurrency: 'EUR',
        transactionDate: '2026-06-04T12:00:00.000Z',
        transactionMerchantName: 'Coffee Shop',
      }),
    ).toEqual({
      settlementAmount: 12.34,
      settlementCurrency: 'EUR',
      transactionDate: '2026-06-04T12:00:00.000Z',
      transactionMerchantName: 'Coffee Shop',
    });
  });

  it('accepts the date-only transaction date a receipt prints, keeping its calendar day in every time zone', () => {
    const parsed = transactionOCRModelOutputSchema.parse({
      settlementAmount: 8.7,
      settlementCurrency: 'EUR',
      transactionDate: '2026-10-14',
      transactionMerchantName: 'CAFE LISBOA',
    });

    expect(parsed.transactionDate).toBe('2026-10-14T12:00:00.000Z');
  });

  it('accepts a transaction date and time printed without a time zone', () => {
    const parsed = transactionOCRModelOutputSchema.parse({
      settlementAmount: 8.7,
      settlementCurrency: 'EUR',
      transactionDate: '2026-10-14T13:05:00',
      transactionMerchantName: 'CAFE LISBOA',
    });

    expect(parsed.transactionDate.slice(0, 10)).toBe('2026-10-14');
  });

  it('rejects an impossible calendar date', () => {
    expect(() =>
      transactionOCRModelOutputSchema.parse({
        settlementAmount: 8.7,
        settlementCurrency: 'EUR',
        transactionDate: '2026-02-31',
        transactionMerchantName: 'CAFE LISBOA',
      }),
    ).toThrow();
  });

  it('rejects malformed OCR output', () => {
    expect(() =>
      transactionOCRModelOutputSchema.parse({
        extra: 'nope',
        settlementAmount: Number.NaN,
        settlementCurrency: 'eur',
        transactionDate: 'not-a-date',
        transactionMerchantName: { name: 'Coffee Shop' },
      }),
    ).toThrow();
  });
});
