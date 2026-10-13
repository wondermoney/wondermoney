import { describe, expect, it } from 'vitest';

import { getAccountMetricsRequestSchema, getAccountsMetricsRequestSchema, getTransactionsRequestSchema, updateTransactionRequestSchema, updateTransactionsRequestSchema } from '../account';
import { unlinkRequisitionRequestSchema } from '../banking';
import { updateCategoryRequestSchema } from '../category';
import { getQuoteRequestSchema, searchTickerRequestSchema } from '../financial-markets';
import { createPortfolioRequestSchema, getAggregateTopMoversRequestSchema, getPortfoliosTransactionRequestSchema, getPortfolioTransactionRequestSchema, suggestPortfolioImportColumnMappingRequestSchema } from '../portfolio';
import { updateUserDataRequestSchema } from '../user';

describe('account, portfolio, and financial market validators', () => {
  it('rejects partial numeric strings and negative ids', () => {
    expect(createPortfolioRequestSchema.safeParse({ body: { currencyId: '-1', name: 'Portfolio' } }).success).toBe(false);
    expect(() => getTransactionsRequestSchema.parse({ query: { limit: '1abc' } })).toThrow();
    expect(() => updateTransactionRequestSchema.parse({ body: {}, params: { transactionId: '-1' } })).toThrow();
  });

  it('rejects invalid dates', () => {
    expect(() => getPortfolioTransactionRequestSchema.parse({ params: { portfolioId: '1' }, query: { fromDate: 'not-a-date' } })).toThrow();
  });

  it('accepts portfolio transaction lookups with a limit', () => {
    expect(getPortfolioTransactionRequestSchema.parse({ params: { portfolioId: 1 }, query: { limit: 1 } }).query.limit).toBe(1);
    expect(getPortfoliosTransactionRequestSchema.parse({ query: { limit: 1 } }).query.limit).toBe(1);
  });

  it('strips the retired portfolio mapping consent field', () => {
    expect(suggestPortfolioImportColumnMappingRequestSchema.parse({ body: { aiAssistConsent: true }, params: { importSessionId: 1 } }).body).toEqual({});
  });

  it('rejects excessive limits', () => {
    expect(() => getAggregateTopMoversRequestSchema.parse({ query: { limit: '1001' } })).toThrow();
  });

  it('accepts safe numeric JSON inputs and epoch-ms date queries', () => {
    const fromDate = new Date('2026-01-01T00:00:00.000Z').getTime();
    const toDate = new Date('2026-01-31T23:59:59.999Z').getTime();
    expect(getTransactionsRequestSchema.parse({ query: { fromDate, limit: 25, toDate } }).query.limit).toBe(25);
    expect(getAccountsMetricsRequestSchema.parse({ query: { fromDate } }).query.fromDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(getAccountMetricsRequestSchema.parse({ params: { accountId: 1 }, query: { fromDate: toDate } }).query.fromDate?.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    expect(updateUserDataRequestSchema.parse({ body: { currency: 978 } }).body.currency).toBe(978);
    expect(updateCategoryRequestSchema.parse({ body: {}, params: { categoryId: 10 } }).params.categoryId).toBe(10);
    expect(unlinkRequisitionRequestSchema.parse({ params: { requisitionId: 13 } }).params.requisitionId).toBe(13);
    expect(updateTransactionsRequestSchema.parse({ body: { transactionIds: [1, '2'] } }).body.transactionIds).toEqual([1, 2]);
  });

  it('rejects partial, non-finite, and unsafe numeric inputs', () => {
    expect(() => getTransactionsRequestSchema.parse({ query: { limit: '1abc' } })).toThrow();
    expect(() => getTransactionsRequestSchema.parse({ query: { limit: Number.POSITIVE_INFINITY } })).toThrow();
    expect(() => updateTransactionRequestSchema.parse({ body: { updatedAmount: '1e309' }, params: { transactionId: 1 } })).toThrow();
    expect(() => updateCategoryRequestSchema.parse({ body: {}, params: { categoryId: '1.2' } })).toThrow();
    expect(() => unlinkRequisitionRequestSchema.parse({ params: { requisitionId: '9007199254740992' } })).toThrow();
  });

  it('rejects invalid ticker and search symbols', () => {
    expect(getQuoteRequestSchema.safeParse({ params: { ticker: 'AAPL!' } }).success).toBe(false);
    expect(searchTickerRequestSchema.safeParse({ query: { searchTerm: 'x'.repeat(101) } }).success).toBe(false);
    expect(getPortfoliosTransactionRequestSchema.safeParse({ query: { ticker: 'AAPL!' } }).success).toBe(false);
  });

  it('rejects overlong fundamentals symbols', () => {
    expect(getQuoteRequestSchema.safeParse({ params: { ticker: 'A'.repeat(21) } }).success).toBe(false);
  });
});
