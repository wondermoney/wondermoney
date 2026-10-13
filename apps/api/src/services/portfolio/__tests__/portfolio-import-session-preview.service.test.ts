import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Appuser } from '@entity/Appuser';

const { em, getOwnedSession } = vi.hoisted(() => ({
  em: { find: vi.fn() },
  getOwnedSession: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/portfolio/portfolio-import-session.service', () => ({ default: { getOwnedSession } }));

import { PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import service from '../portfolio-import-session-preview.service';

describe('portfolio import session preview service', () => {
  const appuser = Object.assign(new Appuser(), { appuserKey: 5 });
  const tenant = { tenantKey: 8 };
  const session = {
    columnMappingJson: {
      confirmed: { columnMapping: { assetName: 'name', extra: 'nope' }, confirmedAt: '2026-06-19T00:00:00.000Z', internalOnly: true, layout: { dataStartRowIndex: 5, extra: 'nope', footerMatchers: ['  footer  ', 123, '', null, { nope: true }], footerRowCount: 2, headerRowIndex: 1, internalOnly: true }, transformations: { dateFormat: 'YYYY-MM-DD', secret: true } },
      internalOnly: true,
      suggestion: { columnMapping: { assetName: 'name', extra: 'nope' }, confidence: 0.9, detectedBroker: { name: 'Broker', secret: true }, internalOnly: true, layout: { dataStartRowIndex: 3, footerMatchers: [' alpha ', '', undefined, 'beta', { nested: 'nope' }], footerRowCount: 4, headerRowIndex: 2, internalOnly: true, stray: 'remove me' }, transformations: { dateFormat: 'YYYY-MM-DD', secret: true }, warning: 'suggestion warning' },
      warning: 'check me',
    },
    financialBrokerKey: { financialBrokerKey: 77, name: 'Broker' },
    portfolioImportSessionKey: 456,
    portfolioKey: { portfolioKey: 12 },
    s3Bucket: 'bucket',
    s3Key: 'key.csv',
    status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
    summaryJson: { assetGroups: { ambiguousGroups: 2, matchedGroups: 1, unmatchedGroups: 3 }, duplicateRows: 4, failureReason: 'select "p0".*, "p1".* from portfolio_import_session', importWorkerError: { message: 'import failed' }, readyRows: Number.NaN, skippedRows: undefined, totalRows: 10 },
    tenantKey: tenant,
  };

  function mockEmptyRelatedData() {
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getOwnedSession.mockReset().mockResolvedValue(session);
    em.find.mockReset();
  });

  it('returns stable empty buckets for needs_column_mapping sessions', async () => {
    getOwnedSession.mockResolvedValueOnce({ ...session, status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result).toMatchObject({
      columnMapping: { confirmed: expect.anything(), suggestion: expect.anything(), warning: 'Automatic column mapping suggestion is unavailable' },
      rows: { duplicate: [], invalid: [], needsAssetReview: [], ready: [] },
      status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING,
    });
    expect(result.rows).toEqual({ duplicate: [], invalid: [], needsAssetReview: [], ready: [] });
    expect(JSON.stringify(result)).not.toContain('portfolio-import-sessions/');
  });

  it('returns review groups first for needs_asset_review sessions', async () => {
    getOwnedSession.mockResolvedValueOnce({ ...session, status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.assetGroups).toEqual([]);
    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
  });

  it('returns session status, portfolio, broker, and normalized summary counts', async () => {
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(getOwnedSession).toHaveBeenCalledWith({ appuser, importSessionId: 456, tenant });
    expect(result).toMatchObject({
      broker: { id: 77, name: 'Broker' },
      importSessionId: 456,
      portfolioId: 12,
      status: PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
      summary: { duplicateRows: 4, failureReason: 'Import processing failed', readyRows: 0, skippedRows: 0, totalRows: 10 },
    });
    expect(result.summary.assetGroups).toEqual({ ambiguousGroups: 2, matchedGroups: 1, providerErrorGroups: 0, totalGroups: 0, unmatchedGroups: 3 });
    expect(result.columnMapping).toEqual({ confirmed: { columnMapping: { assetName: 'name' }, confirmedAt: '2026-06-19T00:00:00.000Z', layout: { dataStartRowIndex: 5, footerMatchers: ['footer'], footerRowCount: 2, headerRowIndex: 1 }, transformations: { dateFormat: 'YYYY-MM-DD' } }, suggestion: { columnMapping: { assetName: 'name' }, confidence: 0.9, detectedBroker: { name: 'Broker' }, layout: { dataStartRowIndex: 3, footerMatchers: ['alpha', 'beta'], footerRowCount: 4, headerRowIndex: 2 }, transformations: { dateFormat: 'YYYY-MM-DD' }, warning: 'suggestion warning' }, warning: 'Automatic column mapping suggestion is unavailable' });
    expect(result.columnMapping as Record<string, unknown>).not.toHaveProperty('internalOnly');
    expect((result.columnMapping?.suggestion as Record<string, unknown> | undefined)).not.toHaveProperty('internalOnly');
    expect((result.columnMapping?.suggestion as Record<string, unknown> | undefined)).not.toHaveProperty('secret');
    expect(((result.columnMapping?.suggestion as Record<string, unknown> | undefined)?.['columnMapping'] as Record<string, unknown> | undefined)).not.toHaveProperty('extra');
    expect(((result.columnMapping?.suggestion as Record<string, unknown> | undefined)?.['detectedBroker'] as Record<string, unknown> | undefined)).not.toHaveProperty('secret');
    expect(((result.columnMapping?.suggestion as Record<string, unknown> | undefined)?.['layout'] as Record<string, unknown> | undefined)).not.toHaveProperty('internalOnly');
    expect(((result.columnMapping?.suggestion as Record<string, unknown> | undefined)?.['layout'] as Record<string, unknown> | undefined)).not.toHaveProperty('stray');
    expect((result.columnMapping?.confirmed as Record<string, unknown> | undefined)).not.toHaveProperty('internalOnly');
    expect(((result.columnMapping?.confirmed as Record<string, unknown> | undefined)?.['transformations'] as Record<string, unknown> | undefined)).not.toHaveProperty('secret');
    expect(((result.columnMapping?.confirmed as Record<string, unknown> | undefined)?.['layout'] as Record<string, unknown> | undefined)).not.toHaveProperty('internalOnly');
    expect(((result.columnMapping?.confirmed as Record<string, unknown> | undefined)?.['layout'] as Record<string, unknown> | undefined)).not.toHaveProperty('extra');
    expect(result).not.toHaveProperty('s3Bucket');
    expect(result).not.toHaveProperty('s3Key');
    expect(result).not.toHaveProperty('objectEtag');
    expect(JSON.stringify(result)).not.toContain('tenantKey');
    expect(JSON.stringify(result)).not.toContain('appuserKey');
  });

  it('includes terminal imported and failed row counts in summary', async () => {
    getOwnedSession.mockResolvedValueOnce({
      ...session,
      status: PortfolioImportSessionStatus.SUCCEEDED,
      summaryJson: {
        duplicateRows: 0,
        failedRows: 2,
        importedRows: 8,
        invalidRows: 0,
        needsAssetReviewRows: 0,
        readyRows: 0,
        skippedRows: 1,
        totalRows: 11,
      },
    });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.summary.importedRows).toBe(8);
    expect(result.summary.failedRows).toBe(2);
  });

  it('exposes sanitized unsupported asset warnings', async () => {
    getOwnedSession.mockResolvedValueOnce({
      ...session,
      summaryJson: { unsupportedAssets: [{ providerError: '401 secret provider detail', skippedRows: 46, symbol: 'EUR.USD' }] },
    });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.summary.unsupportedAssets).toEqual([{ skippedRows: 46, symbol: 'EUR.USD' }]);
    expect(JSON.stringify(result)).not.toContain('401 secret provider detail');
  });

  it('uses explicit summary failure reason before coded fallback errors', async () => {
    getOwnedSession.mockResolvedValueOnce({
      ...session,
      status: PortfolioImportSessionStatus.FAILED,
      summaryJson: { errorCode: 'EMPTY_CSV', failureReason: 'First failed row: Invalid date', parserError: 'CSV_PARSE_FAILED', totalRows: 0 },
    });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.summary.failureReason).toBe('First failed row: Invalid date');
  });

  it('normalizes persisted AWS SDK missing key errors', async () => {
    getOwnedSession.mockResolvedValueOnce({
      ...session,
      status: PortfolioImportSessionStatus.FAILED,
      summaryJson: { errorCode: 'NO_VALUE_PROVIDED_FOR_INPUT_HTTP_LABEL:_KEY.', totalRows: 0 },
    });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.summary.failureReason).toBe('Portfolio import upload key is missing');
  });

  it('never exposes persisted column mapping provider details', async () => {
    const providerError = '401 secret provider detail';
    const safeWarning = 'Automatic column mapping suggestion is unavailable';
    getOwnedSession.mockResolvedValueOnce({
      ...session,
      columnMappingJson: { source: 'error', warning: providerError },
      status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING,
      summaryJson: { columnMappingWarning: providerError },
    });
    mockEmptyRelatedData();

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 5, tenant });

    expect(result.columnMapping?.warning).toBe(safeWarning);
    expect(result.summary.failureReason).toBe(safeWarning);
    expect(JSON.stringify(result)).not.toContain(providerError);
  });

  it('fetches buckets with limit and maps rows', async () => {
    em.find
      .mockResolvedValueOnce([{ assetGroupKey: { portfolioImportAssetGroupKey: 11 }, failureReason: 'fail', financialAssetKey: { financialAssetKey: 22 }, internalTransactionId: 'tx-1', normalizedJson: { b: 2, long: 'y'.repeat(600) }, portfolioImportRowKey: 1, rawJson: { a: 1, fn: () => 'nope', long: 'x'.repeat(600), nested: { keep: true }, sym: Symbol('x'), u: undefined }, rowNumber: 2, skipReason: 'skip', status: PortfolioImportRowStatus.READY }])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: undefined, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 3, skipReason: undefined, status: PortfolioImportRowStatus.DUPLICATE }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 4, rawJson: {}, rowNumber: 4, skipReason: undefined, status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW }])
      .mockResolvedValueOnce([]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 7, tenant });

    expect(em.find).toHaveBeenNthCalledWith(1, expect.any(Function), expect.objectContaining({ deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.READY }), expect.objectContaining({ limit: 7, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] }));
    expect(em.find).toHaveBeenNthCalledWith(2, expect.any(Function), expect.objectContaining({ deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.DUPLICATE }), expect.any(Object));
    expect(result.rows.ready[0]).toMatchObject({ assetGroupId: 11, failureReason: 'fail', financialAssetId: 22, id: 1, internalTransactionId: 'tx-1', normalized: { b: 2 }, raw: { a: 1 }, rowNumber: 2, skipReason: 'skip', status: PortfolioImportRowStatus.READY });
    const readyRow = result.rows.ready[0];
    expect(readyRow).toBeDefined();
    expect(String(readyRow?.raw['long'])).toHaveLength(501);
    expect(readyRow?.raw).not.toHaveProperty('u');
    expect(readyRow?.raw).not.toHaveProperty('fn');
    expect(readyRow?.raw).not.toHaveProperty('sym');
  });

  it('includes ready rows for ready_to_import sessions and keeps duplicates and invalid rows', async () => {
    getOwnedSession.mockResolvedValueOnce({ ...session, status: PortfolioImportSessionStatus.READY_TO_IMPORT });
    em.find
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, skipReason: undefined, status: PortfolioImportRowStatus.READY }])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, skipReason: undefined, status: PortfolioImportRowStatus.DUPLICATE }])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: 'bad', financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 3, rawJson: {}, rowNumber: 3, skipReason: undefined, status: PortfolioImportRowStatus.INVALID }])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 4, rawJson: {}, rowNumber: 4, skipReason: undefined, status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW }])
      .mockResolvedValueOnce([]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.rows.ready.map((row) => row.status)).toEqual([PortfolioImportRowStatus.READY]);
    expect(result.rows.duplicate.map((row) => row.status)).toEqual([PortfolioImportRowStatus.DUPLICATE]);
    expect(result.rows.invalid.map((row) => row.status)).toEqual([PortfolioImportRowStatus.INVALID]);
    expect(result.rows.needsAssetReview.map((row) => row.status)).toEqual([PortfolioImportRowStatus.NEEDS_ASSET_REVIEW]);
  });

  it('includes partial session rows with duplicate and invalid entries', async () => {
    getOwnedSession.mockResolvedValueOnce({ ...session, status: PortfolioImportSessionStatus.PARTIAL });
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: undefined, financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, skipReason: undefined, status: PortfolioImportRowStatus.DUPLICATE }])
      .mockResolvedValueOnce([{ assetGroupKey: undefined, failureReason: 'bad', financialAssetKey: undefined, internalTransactionId: undefined, normalizedJson: {}, portfolioImportRowKey: 3, rawJson: {}, rowNumber: 3, skipReason: undefined, status: PortfolioImportRowStatus.INVALID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.rows.duplicate).toHaveLength(1);
    expect(result.rows.invalid).toHaveLength(1);
  });

  it('maps asset groups, candidates, rejection reasons, and sorts by actionability', async () => {
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { brokerAssetName: 'amb', brokerExchange: 'XNAS', brokerTicker: 'AAA', currency: 'USD', identityHash: '1', isin: 'ISIN1', portfolioImportAssetGroupKey: 1, resolutionReason: 'r1', selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
        { brokerAssetName: 'unm', brokerExchange: 'XNYS', brokerTicker: 'BBB', currency: 'EUR', identityHash: '2', isin: 'ISIN2', portfolioImportAssetGroupKey: 2, resolutionReason: 'r2', selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.UNMATCHED },
        { brokerAssetName: 'perr', brokerExchange: 'XLON', brokerTicker: 'CCC', currency: 'GBP', identityHash: '3', isin: 'ISIN3', portfolioImportAssetGroupKey: 3, resolutionReason: 'r3', selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.PROVIDER_ERROR },
        { brokerAssetName: 'mat', brokerExchange: 'XETR', brokerTicker: 'DDD', currency: 'CHF', identityHash: '4', isin: 'ISIN4', portfolioImportAssetGroupKey: 4, resolutionReason: 'r4', selectedAction: undefined, selectedFinancialAssetKey: { financialAssetKey: 99 }, status: PortfolioImportAssetGroupStatus.MATCHED },
        { brokerAssetName: 'sel', brokerExchange: 'XAMS', brokerTicker: 'EEE', currency: 'SEK', identityHash: '5', isin: 'ISIN5', portfolioImportAssetGroupKey: 5, resolutionReason: 'r5', selectedAction: undefined, selectedFinancialAssetKey: { financialAssetKey: 100 }, status: PortfolioImportAssetGroupStatus.SELECTED },
        { brokerAssetName: 'skip', brokerExchange: 'XPAR', brokerTicker: 'FFF', currency: 'DKK', identityHash: '6', isin: 'ISIN6', portfolioImportAssetGroupKey: 6, resolutionReason: 'r6', selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.SKIPPED },
      ])
      .mockResolvedValueOnce([
        { confidence: '0.4', currency: 'USD', exchange: 'XNAS', hasPriceHistory: false, isin: 'CISIN-1', name: 'B', portfolioImportAssetCandidateKey: 10, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: 'too low', symbol: 'BBB' },
        { confidence: '0.9', currency: 'USD', exchange: 'XNAS', hasPriceHistory: true, isin: 'CISIN-2', name: 'A', portfolioImportAssetCandidateKey: 11, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'AAA' },
        { confidence: '0.9', currency: 'USD', exchange: 'XNAS', hasPriceHistory: true, isin: 'CISIN-3', name: 'C', portfolioImportAssetCandidateKey: 12, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'AAC' },
      ]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.assetGroups.map((group) => group.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.assetGroups[0]?.candidates?.map((candidate) => candidate.id)).toEqual([11, 12, 10]);
    expect(result.assetGroups[0]).toMatchObject({ identity: { brokerAssetName: 'amb', brokerExchange: 'XNAS', brokerTicker: 'AAA', currency: 'USD', isin: 'ISIN1' }, resolutionReason: 'r1', selectedAction: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS });
    expect(result.assetGroups[0]?.candidates?.[0]).toMatchObject({ confidence: 0.9, currency: 'USD', exchange: 'XNAS', hasPriceHistory: true, id: 11, isin: 'CISIN-2', name: 'A', provider: 'provider-a', rejectedReason: undefined, symbol: 'AAA' });
    expect(result.assetGroups[0]?.candidates?.[2]).toMatchObject({ rejectedReason: 'too low' });
  });

  it('recommends the unique candidate matching isin and broker venue aliases', async () => {
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { brokerAssetName: 'amsterdam group', brokerExchange: 'XAMS', brokerTicker: 'AAA', currency: 'EUR', identityHash: '1', isin: 'NL0000001234', portfolioImportAssetGroupKey: 1, resolutionReason: undefined, selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
        { brokerAssetName: 'xetra group', brokerExchange: 'XETA', brokerTicker: 'BBB', currency: 'EUR', identityHash: '2', isin: 'DE0000005678', portfolioImportAssetGroupKey: 2, resolutionReason: undefined, selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
      ])
      .mockResolvedValueOnce([
        { confidence: '0.9', currency: 'EUR', exchange: 'XAMS', hasPriceHistory: true, isin: 'NL0000001234', name: 'Amsterdam match', portfolioImportAssetCandidateKey: 10, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'ABC.AS' },
        { confidence: '0.8', currency: 'EUR', exchange: 'XETRA', hasPriceHistory: true, isin: 'NL0000001234', name: 'Wrong venue', portfolioImportAssetCandidateKey: 11, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'ABC.DE' },
        { confidence: '0.9', currency: 'EUR', exchange: 'XETRA', hasPriceHistory: true, isin: 'DE0000005678', name: 'Xetra match', portfolioImportAssetCandidateKey: 20, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 2 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'XYZ.DE' },
      ]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.assetGroups[0]).toMatchObject({ recommendationReason: 'isin_and_venue_match', recommendedCandidateId: 10 });
    expect(result.assetGroups[0]?.candidates?.[0]).toMatchObject({ id: 10, isRecommended: true });
    expect(result.assetGroups[0]?.candidates?.[1]).toMatchObject({ id: 11, isRecommended: false });
    expect(result.assetGroups[1]).toMatchObject({ recommendationReason: 'isin_and_venue_match', recommendedCandidateId: 20 });
    expect(result.assetGroups[1]?.candidates?.[0]).toMatchObject({ id: 20, isRecommended: true });
  });

  it('does not recommend when multiple candidates match the same isin and venue aliases', async () => {
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { brokerAssetName: 'ambiguous group', brokerExchange: 'XAMS', brokerTicker: 'AAA', currency: 'EUR', identityHash: '1', isin: 'NL0000001234', portfolioImportAssetGroupKey: 1, resolutionReason: undefined, selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
      ])
      .mockResolvedValueOnce([
        { confidence: '0.9', currency: 'EUR', exchange: 'XAMS', hasPriceHistory: true, isin: 'NL0000001234', name: 'Match 1', portfolioImportAssetCandidateKey: 10, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'ABC.AS' },
        { confidence: '0.8', currency: 'EUR', exchange: 'EAM', hasPriceHistory: true, isin: 'NL0000001234', name: 'Match 2', portfolioImportAssetCandidateKey: 11, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 1 }, provider: 'provider-a', rejectedReason: undefined, symbol: 'ABC.AS' },
      ]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.assetGroups[0]).not.toHaveProperty('recommendedCandidateId');
    expect(result.assetGroups[0]).not.toHaveProperty('recommendationReason');
    expect(result.assetGroups[0]?.candidates?.every((candidate) => candidate.isRecommended === false || candidate.isRecommended === undefined)).toBe(true);
  });

  it('sorts groups and candidates deterministically by id ties', async () => {
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { brokerAssetName: 'g2', brokerExchange: 'X', brokerTicker: 'B', currency: 'USD', identityHash: '2', isin: 'I2', portfolioImportAssetGroupKey: 20, resolutionReason: undefined, selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
        { brokerAssetName: 'g1', brokerExchange: 'X', brokerTicker: 'A', currency: 'USD', identityHash: '1', isin: 'I1', portfolioImportAssetGroupKey: 10, resolutionReason: undefined, selectedAction: undefined, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.AMBIGUOUS },
      ])
      .mockResolvedValueOnce([
        { confidence: '0.9', currency: 'USD', exchange: 'X', hasPriceHistory: true, isin: 'I2', name: 'B', portfolioImportAssetCandidateKey: 22, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 20 }, provider: 'p', rejectedReason: undefined, symbol: 'SYM' },
        { confidence: '0.9', currency: 'USD', exchange: 'X', hasPriceHistory: true, isin: 'I1', name: 'A', portfolioImportAssetCandidateKey: 11, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 10 }, provider: 'p', rejectedReason: undefined, symbol: 'SYM' },
      ]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 10, tenant });

    expect(result.assetGroups.map((group) => group.id)).toEqual([10, 20]);
    expect(result.assetGroups[0]?.candidates?.[0]?.id).toBe(11);
    expect(result.assetGroups[1]?.candidates?.[0]?.id).toBe(22);
  });

  it('works when no rows or groups exist', async () => {
    em.find.mockResolvedValue([]);

    const result = await service.getPreview({ appuser, importSessionId: 456, limit: 1, tenant });

    expect(result.rows).toEqual({ duplicate: [], invalid: [], needsAssetReview: [], ready: [] });
    expect(result.assetGroups).toEqual([]);
  });
});
