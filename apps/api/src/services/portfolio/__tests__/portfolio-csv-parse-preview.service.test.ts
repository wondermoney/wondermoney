import { beforeEach, describe, expect, it, vi } from 'vitest';

const { em } = vi.hoisted(() => ({
  em: {
    find: vi.fn(),
    findOne: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockReturnThis(),
  },
}));

const resolverMock = vi.hoisted(() => ({
  resolveImportSessionAssets: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('../portfolio-import-asset-resolution.service', () => ({ default: { resolveImportSessionAssets: resolverMock.resolveImportSessionAssets } }));

import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import PortfolioCsvParsePreviewService from '../portfolio-csv-parse-preview.service';

describe('portfolio csv parse preview service', () => {
  function buildSession(overrides: Record<string, unknown> = {}) {
    return {
      appuserKey: { appuserKey: 1 },
      financialBrokerKey: undefined,
      portfolioImportSessionKey: 456,
      portfolioKey: { portfolioKey: 1 },
      s3Bucket: 'bucket',
      s3Key: 'portfolio-import-sessions/1/456/token.csv',
      status: PortfolioImportSessionStatus.PARSING,
      tenantKey: { tenantKey: 9 },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    em.find.mockReset();
    em.findOne.mockReset();
    em.flush.mockReset().mockResolvedValue(undefined);
    em.persist.mockReset();
    em.persist.mockReturnThis();
    resolverMock.resolveImportSessionAssets.mockReset();
    resolverMock.resolveImportSessionAssets.mockResolvedValue({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: PortfolioImportSessionStatus.READY_TO_IMPORT, totalGroups: 0, unmatchedGroups: 0 });
  });

  function buildDeps(overrides: Record<string, unknown> = {}) {
    return {
      getObjectSize: vi.fn(),
      getObjectText: vi.fn(),
      parseCsvRows: vi.fn(),
      ...overrides,
    };
  }

  function flattenPersisted() {
    return em.persist.mock.calls.reduce<unknown[]>((acc, [value]) => acc.concat(Array.isArray(value) ? value : [value]), []);
  }

  function isSessionValue(value: unknown) {
    return typeof value === 'object' && value !== null && 'summaryJson' in value;
  }

  function hasStatus(value: unknown): value is { status: unknown } {
    return typeof value === 'object' && value !== null && 'status' in value;
  }

  function hasSessionStatus(value: unknown, status: PortfolioImportSessionStatus) {
    const expectedStatus: string = status;
    return hasStatus(value) && String(value.status) === expectedStatus;
  }

  function sessionState(session: ReturnType<typeof buildSession>) {
    return session as { status: PortfolioImportSessionStatus; summaryJson?: Record<string, unknown> };
  }

  function isRowLike(value: Record<string, unknown>, session: Record<string, unknown>) {
    return Boolean(
      value['rawJson']
      || value['rowNumber'] !== undefined
      || value['portfolioImportSessionKey'] === session
    );
  }

  it('creates ready rows and marks the session ready to import', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const normalizedRows = [
      {
        assetSymbol: 'VWCE',
        date: '2026-06-18',
        internalTransactionId: 'row-1',
        quantity: 2,
        settlementCurrencyId: 1,
        transactionTypeId: 1,
        unitPrice: 120,
      },
    ];

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date,assetSymbol,transactionTypeId,quantity,unitPrice,settlementCurrencyId,internalTransactionId\n2026-06-18,VWCE,1,2,120,1,row-1'), parseCsvRows: vi.fn().mockResolvedValue(normalizedRows) }));

    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ portfolioImportSessionKey: 456 }), expect.anything());
    const persisted = flattenPersisted();
    expect(persisted.some((value) => value instanceof PortfolioImportRow && value.internalTransactionId === 'row-1' && value.status === PortfolioImportRowStatus.READY)).toBe(true);
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    expect(persisted.some((value) => isSessionValue(value) && !(value.summaryJson as Record<string, unknown>)['rows'])).toBe(true);
  });

  it('calls asset resolver after persisting supported preview rows', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const resolveImportSessionAssets = vi.fn().mockResolvedValue({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: PortfolioImportSessionStatus.PARTIAL, totalGroups: 0, unmatchedGroups: 0 });
    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]), resolveImportSessionAssets }));

    expect(em.persist).toHaveBeenCalledTimes(2);
    expect(resolveImportSessionAssets).toHaveBeenCalledWith({ importSessionId: 456 });
    expect(resolveImportSessionAssets.mock.invocationCallOrder[0]!).toBeGreaterThan(em.persist.mock.invocationCallOrder[0]!);
  });

  it('preserves assetGroups summary when resolver updates status', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);
    resolverMock.resolveImportSessionAssets.mockImplementation(() => {
      (session as { summaryJson?: Record<string, unknown> }).summaryJson = { ...((session as { summaryJson?: Record<string, unknown> }).summaryJson ?? {}), assetGroups: { matchedGroups: 1 }, resolverNote: 'set by resolver' };
      return Promise.resolve({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW, totalGroups: 1, unmatchedGroups: 1 });
    });

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));

    expect((session as { summaryJson?: Record<string, unknown> }).summaryJson).toEqual(expect.objectContaining({ assetGroups: { matchedGroups: 1 }, resolverNote: 'set by resolver', status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW }));
  });

  it('persists recoverable resolver failures and resolves with needs asset review', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);
    resolverMock.resolveImportSessionAssets.mockRejectedValueOnce(new Error('resolver boom'));

    const service = new PortfolioCsvParsePreviewService();
    await expect(service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }))).resolves.toMatchObject({ status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW });
  });

  it('marks session needs asset review when resolver throws', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);
    resolverMock.resolveImportSessionAssets.mockRejectedValueOnce(new Error('resolver boom'));

    const service = new PortfolioCsvParsePreviewService();
    await expect(service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }))).resolves.toMatchObject({ status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW });

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(sessionState(session).summaryJson).toEqual(expect.objectContaining({ assetResolutionError: { code: 'ASSET_RESOLUTION_FAILED', message: 'resolver boom' } }));
  });

  it('returns needs asset review when resolver requests it', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const resolveImportSessionAssets = vi.fn().mockResolvedValue({ ambiguousGroups: 1, matchedGroups: 0, providerErrorGroups: 0, status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW, totalGroups: 1, unmatchedGroups: 0 });
    const service = new PortfolioCsvParsePreviewService();
    const result = await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]), resolveImportSessionAssets }));

    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
  });

  it('marks duplicate internalTransactionId rows as duplicate', async () => {
    const session = buildSession();
    em.findOne.mockImplementation((entity: { name?: string }, criteria: { internalTransactionId?: string } = {}) => {
      if (entity.name === 'PortfolioImportSession') return session;
      if (entity.name === 'FinancialTransaction' && criteria.internalTransactionId === 'dup-1') return { financialTransactionKey: 99 };
      return null;
    });
    em.find.mockResolvedValueOnce([{ internalTransactionId: 'dup-1' }]);

    const service = new PortfolioCsvParsePreviewService();
    const result = await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'dup-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));

    // Current idempotency is DB-global by FinancialTransaction.internalTransactionId.
    const persisted = flattenPersisted();
    expect(persisted.some((value) => value instanceof PortfolioImportRow && value.internalTransactionId === 'dup-1' && value.status === PortfolioImportRowStatus.DUPLICATE)).toBe(true);
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(persisted.some((value) => isSessionValue(value) && !(value.summaryJson as Record<string, unknown>)['rows'])).toBe(true);
    expect(result).toBeDefined();
  });

  it('marks mixed invalid rows as partial', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([
      { assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'ok-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 },
      { assetSymbol: 'VWCE', date: 'invalid-date', internalTransactionId: 'bad-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 },
    ]) }));

    const persisted = flattenPersisted();
    expect(persisted.some((value) => value instanceof PortfolioImportRow && value.status === PortfolioImportRowStatus.READY)).toBe(true);
    expect(persisted.some((value) => value instanceof PortfolioImportRow && value.status === PortfolioImportRowStatus.INVALID && value.failureReason)).toBe(true);
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(persisted.some((value) => isSessionValue(value) && !(value.summaryJson as Record<string, unknown>)['rows'])).toBe(true);
  });

  it('fails empty csv files with zero rows', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([]) }));

    const persisted = flattenPersisted();
    expect(persisted.find((value) => hasSessionStatus(value, PortfolioImportSessionStatus.FAILED))).toEqual(expect.objectContaining({
      summaryJson: expect.objectContaining({ errorCode: 'EMPTY_CSV' }),
    }));
  });

  it('fails oversized files without creating rows', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectSize: vi.fn().mockResolvedValue(5 * 1024 * 1024 + 1) }));

    expect(flattenPersisted().some((value) => hasSessionStatus(value, PortfolioImportSessionStatus.FAILED))).toBe(true);
    expect(flattenPersisted().some((value) => isRowLike(value as Record<string, unknown>, session))).toBe(false);
  });

  it('requests column mapping for unsupported csv shapes', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date\n2026-06-18'), parseCsvRows: vi.fn().mockResolvedValue([{ date: '2026-06-18' }]) }));

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING);
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
    expect(flattenPersisted().some((value) => typeof value === 'object' && value !== null && 'summaryJson' in value && (value as { summaryJson?: Record<string, unknown> }).summaryJson?.['status'] === PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING)).toBe(true);
  });

  it('requests column mapping when generic csv parsing fails on non-standard layout', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('Generated by Broker\nDate,Qty\n2026-06-18,1'), parseCsvRows: vi.fn().mockImplementation(() => { throw new Error('Invalid Record Length'); }) }));

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING);
    expect(sessionState(session).summaryJson).toEqual(expect.objectContaining({ errorCode: 'INVALID_RECORD_LENGTH', parserError: 'CSV_PARSE_FAILED', status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING }));
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('fails unrecoverable csv object read errors instead of requesting mapping', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockRejectedValue(new Error('NoSuchKey')) }));

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.FAILED);
    expect(sessionState(session).summaryJson).toEqual(expect.objectContaining({ errorCode: 'NOSUCHKEY', status: PortfolioImportSessionStatus.FAILED }));
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('fails with a clear reason when the upload object key is missing', async () => {
    const session = buildSession({ s3Key: undefined });
    em.findOne.mockResolvedValueOnce(session);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps());

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.FAILED);
    expect(sessionState(session).summaryJson).toEqual(expect.objectContaining({ errorCode: 'PORTFOLIO_IMPORT_UPLOAD_KEY_IS_MISSING', failureReason: 'Portfolio import upload key is missing', status: PortfolioImportSessionStatus.FAILED }));
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('does not call resolver for duplicate-only or invalid-only outcomes', async () => {
    const duplicateSession = buildSession();
    em.findOne.mockResolvedValueOnce(duplicateSession);
    em.find.mockResolvedValueOnce([]);
    em.findOne.mockImplementation((entity: { name?: string }, criteria: { internalTransactionId?: string } = {}) => {
      if (entity.name === 'PortfolioImportSession') return duplicateSession;
      if (entity.name === 'FinancialTransaction' && criteria.internalTransactionId === 'dup-1') return { financialTransactionKey: 1 };
      return null;
    });
    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'dup-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();

    const invalidSession = buildSession({ portfolioImportSessionKey: 457 });
    em.findOne.mockResolvedValueOnce(invalidSession);
    em.find.mockResolvedValueOnce([]);
    await service.parseImportSession({ importSessionId: 457 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: 'bad-date', internalTransactionId: 'bad-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('keeps partial when resolver returns ready_to_import', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);
    resolverMock.resolveImportSessionAssets.mockResolvedValueOnce({ ambiguousGroups: 0, matchedGroups: 0, providerErrorGroups: 0, status: PortfolioImportSessionStatus.READY_TO_IMPORT, totalGroups: 1, unmatchedGroups: 0 });

    const service = new PortfolioCsvParsePreviewService();
    const result = await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }, { assetSymbol: 'VWCE', date: 'bad-date', internalTransactionId: 'bad-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));

    expect(result.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.PARTIAL);
  });

  it('supports empty required values when keys are present', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date,assetSymbol,transactionTypeId,quantity,unitPrice,settlementCurrencyId,internalTransactionId'), parseCsvRows: vi.fn().mockResolvedValue([
      { assetSymbol: 'VWCE', date: '', internalTransactionId: 'row-1', quantity: '', settlementCurrencyId: '', transactionTypeId: '', unitPrice: '' },
    ]) }));

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(flattenPersisted().some((value) => value instanceof PortfolioImportRow && value.status === PortfolioImportRowStatus.INVALID)).toBe(true);
  });

  it('needs column mapping when only partial required keys exist', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date,assetSymbol\n2026-06-18,VWCE'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18' }]) }));

    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING);
  });

  it('bubbles persist failures on success path without retrying failed state', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);
    em.flush.mockRejectedValueOnce(new Error('persist boom'));

    const service = new PortfolioCsvParsePreviewService();
    await expect(service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date,assetSymbol,transactionTypeId,quantity,unitPrice,settlementCurrencyId,internalTransactionId\n2026-06-18,VWCE,1,2,120,1,row-1'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }))).rejects.toThrow('persist boom');
    expect(em.persist).toHaveBeenCalledTimes(1);
  });

  it('rejects already-previewed terminal sessions without persisting', async () => {
    const session = buildSession({ status: PortfolioImportSessionStatus.READY_TO_IMPORT, summaryJson: { parseCorrelationId: 'abc' } });
    em.findOne.mockResolvedValueOnce(session);

    const service = new PortfolioCsvParsePreviewService();
    await expect(service.parseImportSession({ importSessionId: 456 }, buildDeps({ parseCsvRows: vi.fn() }))).rejects.toThrow('Import session cannot be parsed');

    expect(em.persist).not.toHaveBeenCalled();
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    expect(sessionState(session).summaryJson).toEqual({ parseCorrelationId: 'abc' });
  });

  it('persists preview rows as entities', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('header'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));

    const persisted = flattenPersisted();
    expect(persisted.some((value) => value instanceof PortfolioImportRow)).toBe(true);
  });

  it('does not use known broker parsers for import-session preview', async () => {
    const session = buildSession({ financialBrokerKey: { financialBrokerKey: 7, name: 'ibkr' } });
    const getBrokerParser = vi.fn();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getBrokerParser, getObjectText: vi.fn().mockResolvedValue('date\n2026-06-18'), parseCsvRows: vi.fn().mockResolvedValue([{ date: '2026-06-18' }]) }));

    expect(getBrokerParser).not.toHaveBeenCalled();
    expect(sessionState(session).status).toBe(PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING);
    expect(resolverMock.resolveImportSessionAssets).not.toHaveBeenCalled();
  });

  it('does not create financial transactions while previewing', async () => {
    const session = buildSession();
    em.findOne.mockResolvedValueOnce(session);
    em.find.mockResolvedValueOnce([]);

    const service = new PortfolioCsvParsePreviewService();
    await service.parseImportSession({ importSessionId: 456 }, buildDeps({ getObjectText: vi.fn().mockResolvedValue('date,assetSymbol,transactionTypeId,quantity,unitPrice,settlementCurrencyId,internalTransactionId\n2026-06-18,VWCE,1,2,120,1,row-1'), parseCsvRows: vi.fn().mockResolvedValue([{ assetSymbol: 'VWCE', date: '2026-06-18', internalTransactionId: 'row-1', quantity: 2, settlementCurrencyId: 1, transactionTypeId: 1, unitPrice: 120 }]) }));

    const persisted = flattenPersisted();
    expect(persisted.some((value) => value instanceof PortfolioImportRow)).toBe(true);
    expect(persisted.some((value) => value instanceof FinancialTransaction)).toBe(false);
    expect(persisted).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ transactionKey: expect.anything() }),
      expect.objectContaining({ settlementAmount: expect.anything() }),
      expect.objectContaining({ settlementCurrencyKey: expect.anything() }),
      expect.objectContaining({ financialTransactionTypeKey: expect.anything() }),
    ]));
  });
});
