import { describe, expect, it, vi } from 'vitest';

const { logger, sentry } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}));

const { em, eodhdSearch, eodhdSearchFn, findReusableAsset } = vi.hoisted(() => {
  const eodhdSearchFn = vi.fn();
  return {
    em: { find: vi.fn(), findOne: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockReturnThis() },
    eodhdSearch: { search: eodhdSearchFn },
    eodhdSearchFn,
    findReusableAsset: vi.fn(),
  };
});

vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@sentry/node', () => ({ captureException: sentry.captureException, captureMessage: sentry.captureMessage }));
vi.mock('@utils/logger', () => ({ default: logger }));
vi.mock('@service/market-data/eodhd.service', () => ({ default: eodhdSearch }));
vi.mock('../portfolio-import-asset-mapping-reuse.service', () => ({ default: { findReusableAsset } }));

import { DI } from '@app/database/di';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportAssetCandidate } from '@entity/PortfolioImportAssetCandidate';
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupSelectedAction, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { Tenant } from '@entity/Tenant';

import portfolioImportAssetResolutionService from '../portfolio-import-asset-resolution.service';

describe('portfolio import asset resolution service', () => {
  const buildSession = (
    status: PortfolioImportSessionStatus = PortfolioImportSessionStatus.UPLOADED,
    overrides: Partial<Pick<PortfolioImportSession, 'financialBrokerKey' | 'tenantKey'>> = {},
  ) => ({
    deletedAt: undefined,
    financialBrokerKey: overrides.financialBrokerKey ?? ({ financialBrokerKey: 22 } as FinancialBroker),
    portfolioImportSessionKey: 1,
    status,
    summaryJson: {},
    tenantKey: overrides.tenantKey ?? ({ tenantKey: 33 } as Tenant),
  } as unknown as PortfolioImportSession);
  let session: PortfolioImportSession;

  function reset() {
    vi.resetAllMocks();
    session = buildSession();
    Object.assign(DI.em, em);
    em.find.mockResolvedValue([]);
    em.findOne.mockImplementation((Entity) => Promise.resolve((Entity === PortfolioImportSession ? session : null)));
    em.flush.mockResolvedValue(undefined);
    em.persist.mockReturnThis();
    findReusableAsset.mockResolvedValue(undefined);
  }

  it('groups rows by identity and links rows to one asset group', async () => {
    reset();
    const row1 = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const row2 = { normalizedJson: { isin: 'ie00b4l5y983' }, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row1, row2]);
    em.find.mockResolvedValueOnce([]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.totalGroups).toBe(1);
    expect(result.matchedGroups).toBe(0);
    expect(result.unmatchedGroups).toBe(1);
    expect(em.persist).toHaveBeenCalled();
    expect(row1.assetGroupKey).toBeDefined();
    expect(row2.assetGroupKey).toBeDefined();
    expect(row1.assetGroupKey).toBe(row2.assetGroupKey);
  });

  it('rejects failed session status', async () => {
    reset();
    session = buildSession(PortfolioImportSessionStatus.FAILED);
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 })).rejects.toThrow('Import session assets cannot be resolved');
    expect(session.status).toBe(PortfolioImportSessionStatus.FAILED);
  });

  it('marks local exact isin matches as matched and sets financialAssetKey for ready rows', async () => {
    reset();
    const asset = { financialAssetKey: 11, isin: 'IE00B4L5Y983', symbol: 'VWCE' } as FinancialAsset;
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(asset);
      return Promise.resolve(null);
    });

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.matchedGroups).toBe(1);
    expect(result.status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    expect(row.status).toBe(PortfolioImportRowStatus.READY);
    expect(row.financialAssetKey).toBe(asset);
  });

  it('applies mapped asset before provider search', async () => {
    reset();
    const asset = { financialAssetKey: 99, isin: 'IE00B4L5Y983' } as FinancialAsset;
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    findReusableAsset.mockResolvedValueOnce(asset);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(findReusableAsset).toHaveBeenCalledWith(expect.objectContaining({ financialBroker: session.financialBrokerKey, identityHash: expect.any(String), tenant: session.tenantKey }));
    expect(eodhdSearchFn).not.toHaveBeenCalled();
    expect(em.findOne).not.toHaveBeenCalledWith(FinancialAsset, expect.objectContaining({ deletedAt: undefined, isin: 'IE00B4L5Y983' }));
    expect(result.matchedGroups).toBe(1);
    expect(result.status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);
    expect(row.financialAssetKey).toBe(asset);
    expect(em.persist.mock.calls[0]?.[0]).toContain(row);
  });

  it('does not apply mappings across tenants', async () => {
    reset();
    session = buildSession(PortfolioImportSessionStatus.UPLOADED, { tenantKey: { tenantKey: 34 } as Tenant });
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(findReusableAsset).toHaveBeenCalledWith(expect.objectContaining({ financialBroker: session.financialBrokerKey, identityHash: expect.any(String), tenant: session.tenantKey }));
    expect(eodhdSearchFn).toHaveBeenCalled();
  });

  it('does not apply mappings across brokers', async () => {
    reset();
    session = buildSession(PortfolioImportSessionStatus.UPLOADED, { financialBrokerKey: { financialBrokerKey: 88 } as FinancialBroker });
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(findReusableAsset).toHaveBeenCalledWith(expect.objectContaining({ financialBroker: session.financialBrokerKey, identityHash: expect.any(String), tenant: session.tenantKey }));
    expect(eodhdSearchFn).toHaveBeenCalled();
  });

  it('continues normal search when reusable lookup returns undefined', async () => {
    reset();
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    findReusableAsset.mockResolvedValueOnce(undefined);
    eodhdSearchFn.mockResolvedValueOnce([]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.unmatchedGroups).toBe(1);
    expect(eodhdSearchFn).toHaveBeenCalled();
  });

  it('calls the default EODHD search with its SDK resource binding', async () => {
    reset();
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockImplementationOnce(function (this: typeof eodhdSearch | undefined) {
      if (this !== eodhdSearch) throw new Error('unbound search');
      return Promise.resolve([{ Code: 'IWDA.AS', ISIN: 'IE00B4L5Y983', Name: 'iShares Core MSCI World UCITS ETF' }]);
    });

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.providerErrorGroups).toBe(0);
    expect(result.ambiguousGroups).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('marks multiple plausible candidates as ambiguous and needs review', async () => {
    reset();
    const row = { normalizedJson: { brokerExchange: 'XETRA', currency: 'EUR', ticker: 'VWCE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([
      { Code: 'VWCE', Currency: 'EUR', Exchange: 'XETRA', Name: 'A' },
      { Code: 'VWCE', Currency: 'EUR', Exchange: 'XETRA', Name: 'B' },
    ]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.matchedGroups).toBe(0);
    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(row.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
  });

  it('automatically skips unsupported groups and emits one warning', async () => {
    reset();
    const row = { normalizedJson: { assetName: 'Unsupported fund', ticker: 'NOPE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const row2 = { normalizedJson: { assetName: 'Unsupported fund', ticker: 'NOPE' }, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row, row2]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.unmatchedGroups).toBe(1);
    expect(result.status).toBe(PortfolioImportSessionStatus.FAILED);
    expect(row.assetGroupKey).toMatchObject({ resolutionReason: 'unsupported_asset', selectedAction: PortfolioImportAssetGroupSelectedAction.SKIP_GROUP, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.SKIPPED });
    expect([row, row2]).toEqual(expect.arrayContaining([expect.objectContaining({ financialAssetKey: undefined, skipReason: 'Unsupported asset', status: PortfolioImportRowStatus.SKIPPED })]));
    expect(session.summaryJson).toMatchObject({ canConfirm: false, failureReason: 'No supported assets were found', needsAssetReviewRows: 0, readyRows: 0, skippedRows: 2, terminalKind: 'failed', unsupportedAssets: [{ skippedRows: 2, symbol: 'NOPE' }] });
    expect(session.summaryJson?.['unsupportedAssets']).toEqual([{ skippedRows: 2, symbol: 'NOPE' }]);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('Portfolio import unsupported asset skipped', expect.objectContaining({ extra: expect.objectContaining({ brokerId: 22, identityHash: expect.any(String), importSessionId: 1, rowCount: 2, symbol: 'NOPE', tenantId: 33 }), level: 'warning' }));
  });

  it('keeps matched rows confirmable when unsupported groups are skipped', async () => {
    reset();
    const asset = { financialAssetKey: 11, isin: 'SUPPORTED' } as FinancialAsset;
    const supported = { normalizedJson: { isin: 'SUPPORTED' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const unsupported = { normalizedJson: { ticker: 'NOPE' }, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([supported, unsupported]);
    em.findOne.mockImplementation((Entity, filter) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset && (filter as { isin?: string }).isin === 'SUPPORTED') return Promise.resolve(asset);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(supported).toMatchObject({ financialAssetKey: asset, status: PortfolioImportRowStatus.READY });
    expect(unsupported).toMatchObject({ status: PortfolioImportRowStatus.SKIPPED });
    expect(session.summaryJson).toMatchObject({ canConfirm: true, importableRows: 1, needsAssetReviewRows: 0, readyRows: 1, skippedRows: 1 });
  });

  it('does not duplicate unsupported warnings on resolver retries', async () => {
    reset();
    const row = { normalizedJson: { ticker: 'NOPE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    eodhdSearchFn.mockResolvedValueOnce([]);
    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });
    const priorGroup = row.assetGroupKey;
    if (!priorGroup) throw new Error('Expected unsupported asset group');

    session.status = PortfolioImportSessionStatus.UPLOADED;
    em.find.mockReset().mockResolvedValueOnce([row]).mockResolvedValueOnce([priorGroup]).mockResolvedValueOnce([]);
    eodhdSearchFn.mockResolvedValueOnce([]);
    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(session.summaryJson?.['unsupportedAssets']).toEqual([{ skippedRows: 1, symbol: 'NOPE' }]);
  });

  it('marks provider errors without throwing', async () => {
    reset();
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockRejectedValueOnce(new Error('boom'));

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.providerErrorGroups).toBe(1);
    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(Error),
      importSessionId: 1,
      lookupType: 'isin',
      lookupValue: 'IE00B4L5Y983',
      provider: 'eodhd',
    }), 'Portfolio import asset provider lookup failed');
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      extra: expect.objectContaining({ importSessionId: 1, lookupType: 'isin', lookupValue: 'IE00B4L5Y983', provider: 'eodhd' }),
      level: 'error',
      tags: expect.objectContaining({ lookupType: 'isin', provider: 'eodhd', stage: 'portfolio-import-asset-resolution' }),
    }));
  });

  it('matches a high-confidence provider candidate only when a local asset exists', async () => {
    reset();
    const row = { normalizedJson: { brokerExchange: 'XETRA', ticker: 'VWCE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const asset = { financialAssetKey: 55, symbol: 'VWCE' } as FinancialAsset;
    em.find.mockImplementation((Entity) => {
      if (Entity === PortfolioImportRow) return Promise.resolve([row]);
      if (Entity === PortfolioImportAssetGroup) return Promise.resolve([]);
      if (Entity === FinancialAsset) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    em.findOne.mockImplementation((Entity, filter): Promise<FinancialAsset | null | PortfolioImportSession> => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset && filter && typeof filter === 'object' && 'symbol' in filter) return Promise.resolve(asset);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([{ Code: 'VWCE', Currency: 'EUR', Exchange: 'XETRA', Name: 'Vanguard FTSE All-World' }]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.matchedGroups).toBe(0);
    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(row.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
    expect(row.financialAssetKey).toBeUndefined();
  });

  it('keeps high-confidence provider candidates needing review when no local asset exists', async () => {
    reset();
    const row = { normalizedJson: { brokerExchange: 'XETRA', ticker: 'VWCE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([{ Code: 'VWCE', Currency: 'EUR', Exchange: 'XETRA', Name: 'Vanguard FTSE All-World' }]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.matchedGroups).toBe(0);
    expect(result.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
    expect(row.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
  });

  it('does not auto-match ticker-only local assets', async () => {
    reset();
    const row = { normalizedJson: { ticker: 'VWCE' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockImplementation((Entity) => {
      if (Entity === PortfolioImportRow) return Promise.resolve([row]);
      if (Entity === PortfolioImportAssetGroup) return Promise.resolve([]);
      if (Entity === FinancialAsset) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    em.findOne.mockImplementation((Entity): Promise<null | PortfolioImportSession> => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([]);

    const result = await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(result.matchedGroups).toBe(0);
    expect(result.status).toBe(PortfolioImportSessionStatus.FAILED);
    expect(row.status).toBe(PortfolioImportRowStatus.SKIPPED);
    expect(em.find).toHaveBeenNthCalledWith(2, PortfolioImportAssetGroup, expect.objectContaining({ deletedAt: undefined, portfolioImportSessionKey: session }));
  });

  it('caches provider searches for the same normalized identity', async () => {
    reset();
    const row1 = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const row2 = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row1, row2]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      return Promise.resolve(null);
    });
    eodhdSearchFn.mockResolvedValueOnce([]);

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(eodhdSearchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid and duplicate rows unchanged', async () => {
    reset();
    const invalid = { assetGroupKey: { portfolioImportAssetGroupKey: 7 } as PortfolioImportAssetGroup, financialAssetKey: { financialAssetKey: 8 } as FinancialAsset, normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.INVALID } as unknown as PortfolioImportRow;
    const duplicate = { assetGroupKey: { portfolioImportAssetGroupKey: 9 } as PortfolioImportAssetGroup, financialAssetKey: { financialAssetKey: 10 } as FinancialAsset, normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 2, rawJson: {}, rowNumber: 2, status: PortfolioImportRowStatus.DUPLICATE } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([invalid, duplicate]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(invalid.status).toBe(PortfolioImportRowStatus.INVALID);
    expect(duplicate.status).toBe(PortfolioImportRowStatus.DUPLICATE);
    expect(invalid.assetGroupKey).toBeDefined();
    expect(invalid.financialAssetKey).toBeDefined();
    expect(duplicate.assetGroupKey).toBeDefined();
    expect(duplicate.financialAssetKey).toBeDefined();
  });

  it('rejects importing when session is importing or succeeded', async () => {
    reset();
    session = buildSession(PortfolioImportSessionStatus.IMPORTING);
    await expect(portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 })).rejects.toThrow('Import session assets cannot be resolved');
    session = buildSession(PortfolioImportSessionStatus.SUCCEEDED);
    await expect(portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 })).rejects.toThrow('Import session assets cannot be resolved');
  });

  it('does not persist financial transactions', async () => {
    reset();
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    const payload = em.persist.mock.calls[0]?.[0];
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as unknown[]).some((item) => item instanceof Object && 'importedFinancialTransactionKey' in (item as object))).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('FinancialTransaction');
  });

  it('keeps ready matched rows ready and includes cleaned and soft-deleted entities in flush payload', async () => {
    reset();
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    const asset = { financialAssetKey: 55, isin: 'IE00B4L5Y983' } as FinancialAsset;
    const existingGroup = { deletedAt: undefined, portfolioImportAssetGroupKey: 99 } as PortfolioImportAssetGroup;
    const existingCandidate = { deletedAt: undefined, portfolioImportAssetCandidateKey: 77 } as PortfolioImportAssetCandidate;
    em.find.mockResolvedValueOnce([row]);
    em.find.mockResolvedValueOnce([existingGroup]);
    em.find.mockResolvedValueOnce([existingCandidate]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(asset);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(row.status).toBe(PortfolioImportRowStatus.READY);
    expect(row.financialAssetKey).toBe(asset);
    const payload = em.persist.mock.calls[0]?.[0] as unknown[];
    expect(payload).toContain(existingGroup);
    expect(payload).toContain(existingCandidate);
    expect(payload).toContain(row);
    expect(payload.some((item) => item === row && (item as PortfolioImportRow).status !== PortfolioImportRowStatus.READY)).toBe(false);
  });

  it('includes cleaned eligible rows without identity in flush payload', async () => {
    reset();
    const row = { assetGroupKey: { portfolioImportAssetGroupKey: 44 } as PortfolioImportAssetGroup, financialAssetKey: { financialAssetKey: 45 } as FinancialAsset, normalizedJson: { currency: 'EUR' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      return Promise.resolve(null);
    });

    await portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 });

    expect(row.assetGroupKey).toBeUndefined();
    expect(row.financialAssetKey).toBeUndefined();
    const payload = em.persist.mock.calls[0]?.[0] as unknown[];
    expect(payload).toContain(row);
  });

  it.each([
    PortfolioImportSessionStatus.READY_TO_IMPORT,
    PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
    PortfolioImportSessionStatus.PARTIAL,
  ])('allows rerun for %s', async (status) => {
    reset();
    session = buildSession(status);
    const row = { normalizedJson: { isin: 'IE00B4L5Y983' }, portfolioImportRowKey: 1, rawJson: {}, rowNumber: 1, status: PortfolioImportRowStatus.READY } as unknown as PortfolioImportRow;
    em.find.mockResolvedValueOnce([row]);
    em.findOne.mockImplementation((Entity) => {
      if (Entity === PortfolioImportSession) return Promise.resolve(session);
      if (Entity === FinancialAsset) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(portfolioImportAssetResolutionService.resolveImportSessionAssets({ importSessionId: 1 })).resolves.toMatchObject({ status: expect.any(String) });
  });
});
