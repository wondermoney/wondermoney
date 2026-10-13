import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em } = vi.hoisted(() => {
  const em = { find: vi.fn(), findOne: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn(function () { return em; }), transactional: vi.fn(async (callback: (entityManager: typeof em) => Promise<unknown>) => callback(em)) };
  return { em };
});
const { createPortfolioTransaction } = vi.hoisted(() => ({ createPortfolioTransaction: vi.fn() }));

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('../portfolio-transaction.service.js', () => ({ default: { createPortfolioTransaction } }));

import { PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import service from '../portfolio-import-finalize.service';

describe('portfolio import finalize service', () => {
  const appuser = { appuserKey: 9 };
  const tenant = { tenantKey: 8 };
  const portfolio = { portfolioKey: 12 };
  const broker = { financialBrokerKey: 77 };
  interface CurrencyMock { code: string; currencyKey: number }
  interface TransactionTypeMock { financialTransactionTypeKey: number; name: string }

  function buildSession(overrides: Record<string, unknown> = {}) {
    return {
      appuserKey: appuser,
      financialBrokerKey: broker,
      portfolioImportSessionKey: 456,
      portfolioKey: portfolio,
      status: PortfolioImportSessionStatus.IMPORTING,
      summaryJson: { note: 'keep-me' },
      tenantKey: tenant,
      ...overrides,
    };
  }

  function mockFindOneForImport(params: {
    createdTransactions?: Record<string, unknown>;
    currencies?: Record<string, CurrencyMock>;
    existingTransactions?: Record<string, unknown>;
    precheckTransactions?: Record<string, unknown>;
    session?: Record<string, unknown>;
    transactionTypes?: Record<string, TransactionTypeMock>;
  } = {}) {
    interface FindOneCriteria {
      code?: string;
      currencyKey?: number;
      financialTransactionTypeKey?: number;
      internalTransactionId?: string;
      name?: string;
    }
    const createdTransactions = params.createdTransactions ?? {};
    const existingTransactions = params.existingTransactions ?? {};
    const precheckTransactions = params.precheckTransactions ?? {};
    const session = params.session ?? buildSession();
    const transactionTypes: Record<string, TransactionTypeMock> = params.transactionTypes ?? { BUY: { financialTransactionTypeKey: 1, name: 'BUY' } };
    const currencies: Record<string, CurrencyMock> = params.currencies ?? { EUR: { code: 'EUR', currencyKey: 151 } };
    const transactionLookupCounts = new Map<string, number>();

    em.findOne.mockImplementation((entity: { name?: string }, criteria: FindOneCriteria = {}) => {
      if (entity.name === 'PortfolioImportSession') return session;
      if (entity.name === 'FinancialTransactionType') return transactionTypes[String(criteria.name ?? criteria.financialTransactionTypeKey)] ?? null;
      if (entity.name === 'Currency') return currencies[String(criteria.code ?? criteria.currencyKey)] ?? null;
      if (entity.name === 'FinancialTransaction') {
        const id = criteria.internalTransactionId;
        if (!id) return null;
        const count = (transactionLookupCounts.get(id) ?? 0) + 1;
        transactionLookupCounts.set(id, count);
        if (count === 1) return precheckTransactions[id] ?? null;
        if (count >= 2) return createdTransactions[id] ?? existingTransactions[id] ?? null;
        return null;
      }
      return null;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    em.find.mockReset();
    em.findOne.mockReset();
    em.persist.mockReset();
    createPortfolioTransaction.mockReset();
  });

  it('rejects missing sessions', async () => {
    em.findOne.mockResolvedValueOnce(null);

    await expect(service.finalizeImportSession({ importSessionId: 456 })).rejects.toThrow('Import session not found');
  });

  it('rejects non-importing sessions', async () => {
    em.findOne.mockResolvedValueOnce(buildSession({ status: PortfolioImportSessionStatus.READY_TO_IMPORT }));

    await expect(service.finalizeImportSession({ importSessionId: 456 })).rejects.toThrow('Import session cannot be finalized');
  });

  it('imports ready rows only and preserves other row statuses', async () => {
    const session = buildSession({ columnMappingJson: { appliedParserSpecContentHash: 'hash-501', appliedParserSpecKey: 401, candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501 }, summaryJson: { note: 'keep-me', unsupportedAssets: [{ skippedRows: 1, symbol: 'NOPE' }] } });
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionKey: 900 }, 'row-2': { internalTransactionId: 'row-2', transactionKey: 901 } }, session });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
      { financialAssetKey: { symbol: 'XYZ' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'dup-1', normalizedJson: { date: '2026-01-02', quantity: 3, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 11 }, portfolioImportRowKey: 2, status: PortfolioImportRowStatus.DUPLICATE },
      { financialAssetKey: { symbol: 'XYZ' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-2', normalizedJson: { date: '2026-01-03', quantity: 4, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 12 }, portfolioImportRowKey: 3, status: PortfolioImportRowStatus.SKIPPED },
    ]);
    createPortfolioTransaction.mockResolvedValueOnce(undefined);

    const promoteParserSpec = vi.fn().mockResolvedValue({ globalParserSpecKey: 601, status: 'promoted' });
    const recordAppliedSpecSuccess = vi.fn().mockResolvedValue(undefined);
    const result = await service.finalizeImportSession({ importSessionId: 456 }, { promoteParserSpec, recordAppliedSpecSuccess });

    expect(createPortfolioTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ duplicateRows: 1, importedRows: 1, readyRows: 0, skippedRows: 1, status: PortfolioImportSessionStatus.PARTIAL, totalRows: 3 });
    expect(createPortfolioTransaction).toHaveBeenCalledWith(appuser, expect.objectContaining({ brokerId: 77, externalTransactionId: undefined, financialAsset: expect.objectContaining({ symbol: 'ABC' }), financialTransactionTypeId: 1, internalTransactionId: 'row-1', notes: undefined, quantity: 2, settlementCurrencyId: 151, skipMaintenance: true, tenantId: 8, transactionDate: new Date('2026-01-01T00:00:00.000Z'), unitPrice: 10 }), em);
    expect(session.summaryJson).toEqual(expect.objectContaining({ skippedRows: 1, status: PortfolioImportSessionStatus.PARTIAL, unsupportedAssets: [{ skippedRows: 1, symbol: 'NOPE' }] }));
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ portfolioImportSessionKey: 456 }), expect.objectContaining({ populate: ['appuserKey.currencyKey', 'portfolioKey', 'tenantKey', 'financialBrokerKey'] }));
    expect(em.persist).toHaveBeenCalled();
    expect(promoteParserSpec).toHaveBeenCalledWith({ expectedBrokerKey: 77, expectedContentHash: 'hash-501', expectedTenantKey: 8, parserSpecKey: 501 }, em);
    expect((session as typeof session & { columnMappingJson?: Record<string, unknown> }).columnMappingJson).toMatchObject({ parserSpecPromotion: { candidateParserSpecKey: 501, globalParserSpecKey: 601, status: 'promoted' } });
    expect(recordAppliedSpecSuccess).toHaveBeenCalledWith({ contentHash: 'hash-501', parserSpecKey: 401 }, em);
  });

  it('keeps a successful import committed when nested parser promotion fails', async () => {
    const session = buildSession({ columnMappingJson: { appliedParserSpecContentHash: 'old-hash', appliedParserSpecKey: 401, candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501 } });
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionDate: new Date('2026-01-01'), transactionKey: 900 } }, session });
    em.find.mockResolvedValueOnce([{ financialAssetKey: { symbol: 'ABC' }, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY }]);
    createPortfolioTransaction.mockResolvedValueOnce(undefined);

    const recordAppliedSpecSuccess = vi.fn();
    const result = await service.finalizeImportSession({ importSessionId: 456 }, { promoteParserSpec: vi.fn().mockRejectedValue(new Error('promotion down')), recordAppliedSpecSuccess });

    expect(result).toMatchObject({ importedRows: 1, status: PortfolioImportSessionStatus.SUCCEEDED });
    expect((session as typeof session & { columnMappingJson?: Record<string, unknown> }).columnMappingJson).toMatchObject({ parserSpecPromotion: { candidateParserSpecKey: 501, status: 'failed' } });
    expect(recordAppliedSpecSuccess).not.toHaveBeenCalled();
  });

  it('isolates applied-spec feedback failure in a nested transaction', async () => {
    const session = buildSession({ columnMappingJson: { appliedParserSpecContentHash: 'same-hash', appliedParserSpecKey: 401, candidateParserSpecContentHash: 'same-hash' } });
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionDate: new Date('2026-01-01'), transactionKey: 900 } }, session });
    em.find.mockResolvedValueOnce([{ financialAssetKey: { symbol: 'ABC' }, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY }]);
    createPortfolioTransaction.mockResolvedValueOnce(undefined);
    const recordAppliedSpecSuccess = vi.fn().mockRejectedValue(new Error('feedback write failed'));

    const result = await service.finalizeImportSession({ importSessionId: 456 }, { recordAppliedSpecSuccess });

    expect(result).toMatchObject({ importedRows: 1, status: PortfolioImportSessionStatus.SUCCEEDED });
    expect(recordAppliedSpecSuccess).toHaveBeenCalledWith({ contentHash: 'same-hash', parserSpecKey: 401 }, em);
    expect(em.transactional).toHaveBeenCalledTimes(2);
    expect((session as typeof session & { columnMappingJson?: Record<string, unknown> }).columnMappingJson).toMatchObject({ appliedSpecFeedback: { attemptCount: 1, status: 'failed' } });
  });

  it('retries failed parser promotion idempotently from durable session metadata', async () => {
    const session = buildSession({ columnMappingJson: { candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501, parserSpecPromotion: { attemptCount: 1, status: 'failed' } }, status: PortfolioImportSessionStatus.SUCCEEDED, summaryJson: { failedRows: 0, importedRows: 1, invalidRows: 0, terminalKind: 'success' } });
    em.findOne.mockResolvedValue(session);
    const promoteParserSpec = vi.fn().mockResolvedValue({ globalParserSpecKey: 601, status: 'promoted' });

    await expect(service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec })).resolves.toMatchObject({ attemptCount: 2, globalParserSpecKey: 601, status: 'promoted' });
    await service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec });

    expect(promoteParserSpec).toHaveBeenCalledTimes(1);
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ portfolioImportSessionKey: 456 }), expect.objectContaining({ lockMode: expect.anything(), populate: ['financialBrokerKey', 'tenantKey'] }));
  });

  it('does not retry awaiting-finalization or non-terminal partial sessions', async () => {
    const awaiting = buildSession({ columnMappingJson: { candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501, parserSpecPromotion: { status: 'awaiting_finalization' } }, status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { failedRows: 0, importedRows: 0, invalidRows: 0 } });
    em.findOne.mockResolvedValueOnce(awaiting);
    const promoteParserSpec = vi.fn();
    await expect(service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec })).resolves.toMatchObject({ status: 'awaiting_finalization' });
    expect(promoteParserSpec).not.toHaveBeenCalled();

    const nonTerminal = buildSession({ columnMappingJson: { candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501, parserSpecPromotion: { status: 'failed' } }, status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { failedRows: 0, importedRows: 0, invalidRows: 0, terminalKind: 'partial_success' } });
    em.findOne.mockResolvedValueOnce(nonTerminal);
    await expect(service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec })).rejects.toThrow('before successful finalization');
    expect(promoteParserSpec).not.toHaveBeenCalled();
  });

  it('keeps ineligible promotion terminal across retries', async () => {
    const session = buildSession({ columnMappingJson: { candidateParserSpecContentHash: 'hash-501', candidateParserSpecKey: 501, parserSpecPromotion: { attemptCount: 1, status: 'failed' } }, status: PortfolioImportSessionStatus.PARTIAL, summaryJson: { failedRows: 0, importedRows: 1, invalidRows: 0, terminalKind: 'partial_success' } });
    em.findOne.mockResolvedValue(session);
    const promoteParserSpec = vi.fn().mockResolvedValue({ status: 'ineligible' });
    await expect(service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec })).resolves.toMatchObject({ status: 'ineligible' });
    await expect(service.retryParserSpecPromotion({ importSessionId: 456 }, { promoteParserSpec })).resolves.toMatchObject({ status: 'ineligible' });
    expect(promoteParserSpec).toHaveBeenCalledTimes(1);
  });

  it('processes rows chronologically by date then row number', async () => {
    const session = buildSession();
    mockFindOneForImport({ createdTransactions: { a: { internalTransactionId: 'a', transactionKey: 900 }, b: { internalTransactionId: 'b', transactionKey: 901 } }, session });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'b', normalizedJson: { date: '2026-01-02', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 2, rowNumber: 2, status: PortfolioImportRowStatus.READY },
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'a', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, rowNumber: 1, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValue(undefined);

    await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction.mock.calls.map(([, params]) => (params as { internalTransactionId: string }).internalTransactionId)).toEqual(['a', 'b']);
  });

  it('creates transactions with the outer transactional entity manager', async () => {
    const transactionalEm = { ...em };
    em.transactional.mockImplementationOnce(async (callback: (entityManager: typeof em) => Promise<unknown>) => callback(transactionalEm));
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionKey: 900 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValueOnce(undefined);

    await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).toHaveBeenCalledWith(appuser, expect.any(Object), transactionalEm);
  });

  it('supports parse-preview rows with numeric type and currency ids', async () => {
    mockFindOneForImport({ currencies: { 151: { code: 'EUR', currencyKey: 151 }, EUR: { code: 'EUR', currencyKey: 151 } }, transactionTypes: { 1: { financialTransactionTypeKey: 1, name: 'BUY' }, BUY: { financialTransactionTypeKey: 1, name: 'BUY' } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyId: 151, transactionTypeId: 1, unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);

    await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).toHaveBeenCalledWith(appuser, expect.objectContaining({ financialTransactionTypeId: 1, settlementCurrencyId: 151 }), em);
  });

  it('defaults fee currency to settlement currency when fee is present', async () => {
    mockFindOneForImport();
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', feeAmount: 1.5, quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValueOnce(undefined);

    await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).toHaveBeenCalledWith(appuser, expect.objectContaining({ feeAmount: 1.5, feeCurrencyId: 151 }), em);
  });

  it('marks rows duplicate for any existing internalTransactionId', async () => {
    mockFindOneForImport({ precheckTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionKey: 123 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 1 });
  });

  it('treats inserted transactions after create failure as imported', async () => {
    const session = buildSession();
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionKey: 900 } }, session });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockRejectedValueOnce(new Error('boom'));

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(result).toMatchObject({ failedRows: 0, importedRows: 1 });
    expect(session.summaryJson).toEqual(expect.objectContaining({ importMaintenanceError: 'boom' }));
  });

  it('marks matching existing transactions as duplicates', async () => {
    mockFindOneForImport({ precheckTransactions: { 'row-1': { externalTransactionId: undefined, feeAmount: undefined, feeCurrencyKey: undefined, financialAssetKey: { financialAssetKey: 99 }, financialTransactionTypeKey: { financialTransactionTypeKey: 1, name: 'BUY' }, internalTransactionId: 'row-1', originalCurrencyKey: undefined, originalUnitAmount: undefined, portfolioKey: { portfolioKey: 12 }, quantity: 2, settlementCurrencyKey: { code: 'EUR', currencyKey: 151 }, settlementUnitAmount: 10, transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 123 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { financialAssetKey: 99, symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, portfolioImportSessionKey: buildSession(), status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 0, importedRows: 1, skippedRows: 0, status: PortfolioImportSessionStatus.SUCCEEDED });
  });

  it('idempotently imports an existing signed SELL from a positive import magnitude', async () => {
    const existing = { financialAssetKey: { financialAssetKey: 99 }, financialTransactionTypeKey: { financialTransactionTypeKey: 2, name: 'SELL' }, internalTransactionId: 'row-sell', portfolioKey: { portfolioKey: 12 }, quantity: -2, settlementCurrencyKey: { code: 'EUR', currencyKey: 151 }, settlementUnitAmount: 10, transactionDate: new Date('2026-01-03T00:00:00.000Z'), transactionKey: 124 };
    mockFindOneForImport({ precheckTransactions: { 'row-sell': existing }, transactionTypes: { SELL: { financialTransactionTypeKey: 2, name: 'SELL' } } });
    const row = { financialAssetKey: { financialAssetKey: 99, symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-sell', normalizedJson: { date: '2026-01-03', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'SELL', unitPrice: 10 }, portfolioImportRowKey: 1, portfolioImportSessionKey: buildSession(), status: PortfolioImportRowStatus.READY };
    em.find.mockResolvedValueOnce([row]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 0, importedRows: 1, skippedRows: 0, status: PortfolioImportSessionStatus.SUCCEEDED });
    expect(row).toMatchObject({ importedFinancialTransactionKey: existing, status: PortfolioImportRowStatus.IMPORTED });
  });

  it('marks existing transactions with mismatched unit price as duplicates', async () => {
    mockFindOneForImport({ precheckTransactions: { 'row-1': { financialAssetKey: { financialAssetKey: 99 }, financialTransactionTypeKey: { name: 'BUY' }, internalTransactionId: 'row-1', portfolioKey: { portfolioKey: 12 }, quantity: 2, settlementCurrencyKey: { code: 'EUR', currencyKey: 151 }, settlementUnitAmount: 9, transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 123 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { financialAssetKey: 99, symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, portfolioImportSessionKey: buildSession(), status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 1, failedRows: 0, importedRows: 0, status: PortfolioImportSessionStatus.FAILED });
  });

  it('marks existing transactions with mismatched settlement currency as duplicates', async () => {
    mockFindOneForImport({ precheckTransactions: { 'row-1': { financialAssetKey: { financialAssetKey: 99 }, financialTransactionTypeKey: { name: 'BUY' }, internalTransactionId: 'row-1', portfolioKey: { portfolioKey: 12 }, quantity: 2, settlementCurrencyKey: { code: 'USD', currencyKey: 152 }, settlementUnitAmount: 10, transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 123 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { financialAssetKey: 99, symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, portfolioImportSessionKey: buildSession(), status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 1, importedRows: 0, status: PortfolioImportSessionStatus.FAILED });
  });

  it('marks conflicting existing transactions as duplicates', async () => {
    mockFindOneForImport({ precheckTransactions: { 'dup-1': { internalTransactionId: 'dup-1', transactionKey: 123 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'dup-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(createPortfolioTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ duplicateRows: 1, importedRows: 0, skippedRows: 0, status: PortfolioImportSessionStatus.FAILED });
  });

  it('marks rows failed when required normalized fields are missing', async () => {
    const session = buildSession();
    mockFindOneForImport({ session });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(result).toMatchObject({ failedRows: 1, importedRows: 0 });
    expect(session.summaryJson).toEqual(expect.objectContaining({ failureReason: 'Invalid date', status: PortfolioImportSessionStatus.FAILED }));
  });

  it('rejects impossible calendar dates', async () => {
    mockFindOneForImport();
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-02-31', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(result).toMatchObject({ failedRows: 1, importedRows: 0 });
  });

  it('continues when createPortfolioTransaction fails', async () => {
    mockFindOneForImport({ createdTransactions: { 'row-2': { internalTransactionId: 'row-2', transactionKey: 902 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-2', normalizedJson: { date: '2026-01-02', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 2, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    const result = await service.finalizeImportSession({ importSessionId: 456 });

    expect(result).toMatchObject({ failedRows: 1, importedRows: 1, status: PortfolioImportSessionStatus.PARTIAL });
  });

  it('calls maintenance after imports with earliest date', async () => {
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 900 }, 'row-2': { internalTransactionId: 'row-2', transactionDate: new Date('2026-01-02T00:00:00.000Z'), transactionKey: 901 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-2', normalizedJson: { date: '2026-01-02', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 2, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValue(undefined);
    const triggerMaintenance = vi.fn().mockResolvedValue(undefined);

    await service.finalizeImportSession({ importSessionId: 456 }, { triggerMaintenance });

    expect(triggerMaintenance).toHaveBeenCalledWith({ earliestTransactionDate: new Date('2026-01-01T00:00:00.000Z'), portfolioId: 12 });
  });

  it('uses earliest newly imported date for maintenance and ignores pre-existing imported rows', async () => {
    mockFindOneForImport({ createdTransactions: { 'row-2': { internalTransactionId: 'row-2', transactionDate: new Date('2026-01-02T00:00:00.000Z'), transactionKey: 901 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: { transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 800 }, internalTransactionId: 'row-0', normalizedJson: { date: '2026-01-01', quantity: 1, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 0, status: PortfolioImportRowStatus.IMPORTED },
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-2', normalizedJson: { date: '2026-01-02', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 2, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValue(undefined);
    const triggerMaintenance = vi.fn().mockResolvedValue(undefined);

    await service.finalizeImportSession({ importSessionId: 456 }, { triggerMaintenance });

    expect(triggerMaintenance).toHaveBeenCalledWith({ earliestTransactionDate: new Date('2026-01-02T00:00:00.000Z'), portfolioId: 12 });
  });

  it('does not trigger maintenance for only pre-existing imported rows', async () => {
    mockFindOneForImport();
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: { transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 800 }, internalTransactionId: 'row-0', normalizedJson: { date: '2026-01-01', quantity: 1, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 0, status: PortfolioImportRowStatus.IMPORTED },
    ]);
    const triggerMaintenance = vi.fn().mockResolvedValue(undefined);

    const result = await service.finalizeImportSession({ importSessionId: 456 }, { triggerMaintenance });

    expect(result).toMatchObject({ importedRows: 1, status: PortfolioImportSessionStatus.SUCCEEDED });
    expect(triggerMaintenance).not.toHaveBeenCalled();
  });

  it('records maintenance failures without throwing', async () => {
    mockFindOneForImport({ createdTransactions: { 'row-1': { internalTransactionId: 'row-1', transactionDate: new Date('2026-01-01T00:00:00.000Z'), transactionKey: 900 } } });
    em.find.mockResolvedValueOnce([
      { financialAssetKey: { symbol: 'ABC' }, importedFinancialTransactionKey: undefined, internalTransactionId: 'row-1', normalizedJson: { date: '2026-01-01', quantity: 2, settlementCurrencyCode: 'EUR', transactionType: 'BUY', unitPrice: 10 }, portfolioImportRowKey: 1, status: PortfolioImportRowStatus.READY },
    ]);
    createPortfolioTransaction.mockResolvedValue(undefined);
    const triggerMaintenance = vi.fn().mockRejectedValue(new Error('maintenance failed'));

    const result = await service.finalizeImportSession({ importSessionId: 456 }, { triggerMaintenance });

    expect(result).toMatchObject({ importedRows: 1, status: PortfolioImportSessionStatus.SUCCEEDED });
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ summaryJson: expect.objectContaining({ importMaintenanceError: 'maintenance failed' }) }));
  });
});
