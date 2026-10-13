import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveOrCreateFinancialAssetMock = vi.hoisted(() => vi.fn());
const getOwnedSessionMock = vi.hoisted(() => vi.fn());
const saveReusableMappingMock = vi.hoisted(() => vi.fn());

vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('../financial-asset.service', () => ({ resolveOrCreateFinancialAsset: resolveOrCreateFinancialAssetMock }));
vi.mock('../portfolio-import-asset-mapping-reuse.service', () => ({ default: { saveReusableMapping: saveReusableMappingMock } }));
vi.mock('../portfolio-import-session.service', () => ({ default: { getOwnedSession: getOwnedSessionMock } }));

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { PortfolioImportAssetCandidate } from '@entity/PortfolioImportAssetCandidate';
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupSelectedAction, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

import service from '../portfolio-import-asset-mapping.service';

describe('portfolio import asset mapping service', () => {
  const appuser = { appuserKey: 1 } as Appuser;
  const tenant = { tenantKey: 2 };
  function setup(overrides: { candidates?: PortfolioImportAssetCandidate[]; financialAssets?: FinancialAsset[]; groups?: PortfolioImportAssetGroup[]; rows?: PortfolioImportRow[]; sessionStatus?: PortfolioImportSessionStatus } = {}) {
    const session = {
      deletedAt: undefined,
      financialBrokerKey: { financialBrokerKey: 77 },
      portfolioImportSessionKey: 10,
      status: overrides.sessionStatus ?? PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
      summaryJson: { keepMe: true, nested: { preserved: true } },
      tenantKey: { tenantKey: 999 },
    } as unknown as PortfolioImportSession;
    const group1 = { deletedAt: undefined, portfolioImportAssetGroupKey: 101, portfolioImportSessionKey: session, status: PortfolioImportAssetGroupStatus.AMBIGUOUS } as PortfolioImportAssetGroup;
    const group2 = { deletedAt: undefined, portfolioImportAssetGroupKey: 102, portfolioImportSessionKey: session, status: PortfolioImportAssetGroupStatus.MATCHED } as PortfolioImportAssetGroup;
    const group3 = { deletedAt: undefined, portfolioImportAssetGroupKey: 103, portfolioImportSessionKey: session, status: PortfolioImportAssetGroupStatus.MATCHED } as PortfolioImportAssetGroup;
    const candidate1 = { deletedAt: undefined, portfolioImportAssetCandidateKey: 201, portfolioImportAssetGroupKey: group1, symbol: 'AAPL' } as PortfolioImportAssetCandidate;
    const candidateNoSymbol = { deletedAt: undefined, portfolioImportAssetCandidateKey: 202, portfolioImportAssetGroupKey: group1, symbol: undefined } as PortfolioImportAssetCandidate;
    const candidateSameGroupKeyDifferentObject = { deletedAt: undefined, portfolioImportAssetCandidateKey: 204, portfolioImportAssetGroupKey: { portfolioImportAssetGroupKey: 101 } as PortfolioImportAssetGroup, symbol: 'AAPL' } as PortfolioImportAssetCandidate;
    const otherGroupCandidate = { deletedAt: undefined, portfolioImportAssetCandidateKey: 203, portfolioImportAssetGroupKey: group2, symbol: 'MSFT' } as PortfolioImportAssetCandidate;
    const asset = { deletedAt: undefined, financialAssetKey: 301, symbol: 'AAPL' } as FinancialAsset;
    const rows = (groupA = group1, groupB = group2) => ([
      { assetGroupKey: groupA, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 1, portfolioImportSessionKey: session, rowNumber: 1, skipReason: undefined, status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW },
      { assetGroupKey: groupA, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 2, portfolioImportSessionKey: session, rowNumber: 2, skipReason: 'old skip', status: PortfolioImportRowStatus.SKIPPED },
      { assetGroupKey: groupA, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 3, portfolioImportSessionKey: session, rowNumber: 3, skipReason: undefined, status: PortfolioImportRowStatus.READY },
      { assetGroupKey: groupA, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 4, portfolioImportSessionKey: session, rowNumber: 4, skipReason: 'dup', status: PortfolioImportRowStatus.DUPLICATE },
      { assetGroupKey: groupB, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 5, portfolioImportSessionKey: session, rowNumber: 5, skipReason: undefined, status: PortfolioImportRowStatus.INVALID },
      { assetGroupKey: group3, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 6, portfolioImportSessionKey: session, rowNumber: 6, skipReason: undefined, status: PortfolioImportRowStatus.READY },
      { assetGroupKey: group3, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 7, portfolioImportSessionKey: session, rowNumber: 7, skipReason: 'pending', status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW },
      { assetGroupKey: undefined, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 8, portfolioImportSessionKey: session, rowNumber: 8, skipReason: undefined, status: PortfolioImportRowStatus.IMPORTED },
      { assetGroupKey: undefined, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 9, portfolioImportSessionKey: session, rowNumber: 9, skipReason: undefined, status: PortfolioImportRowStatus.FAILED },
    ]) as PortfolioImportRow[];
    const persisted: unknown[] = [];
    const flush = vi.fn().mockImplementation((values?: unknown) => {
      if (values !== undefined) persisted.push(...(Array.isArray(values) ? values : [values]));
      return Promise.resolve();
    });
    const state = {
      candidates: overrides.candidates ?? [candidate1, candidateNoSymbol, candidateSameGroupKeyDifferentObject, otherGroupCandidate],
      financialAssets: overrides.financialAssets ?? [asset],
      fixtures: { asset, candidate1, candidateNoSymbol, candidateSameGroupKeyDifferentObject, group1, group2, group3, otherGroupCandidate },
      groups: overrides.groups ?? [group1, group2, group3],
      rows: overrides.rows ?? rows(),
      session,
    };
    resolveOrCreateFinancialAssetMock.mockResolvedValue(state.fixtures.asset);
    getOwnedSessionMock.mockResolvedValue(state.session);
    Object.assign(DI.em, {
      find: vi.fn().mockImplementation((entity, criteria) => {
        const sessionKey = criteria?.portfolioImportSessionKey?.portfolioImportSessionKey ?? criteria?.portfolioImportSessionKey;
        if (entity === PortfolioImportAssetGroup) {
          return Promise.resolve(state.groups.filter((group) => {
            if (criteria?.deletedAt !== undefined && group.deletedAt !== criteria.deletedAt) return false;
            if (sessionKey !== undefined && group.portfolioImportSessionKey.portfolioImportSessionKey !== sessionKey) return false;
            if (criteria?.portfolioImportAssetGroupKey?.$in) return criteria.portfolioImportAssetGroupKey.$in.includes(group.portfolioImportAssetGroupKey);
            if (criteria?.portfolioImportAssetGroupKey !== undefined) return group.portfolioImportAssetGroupKey === criteria.portfolioImportAssetGroupKey;
            return true;
          }));
        }
        if (entity === PortfolioImportAssetCandidate) return Promise.resolve(state.candidates.filter((candidate) => {
          if (criteria?.deletedAt !== undefined && candidate.deletedAt !== criteria.deletedAt) return false;
          const candidateGroupKey = candidate.portfolioImportAssetGroupKey.portfolioImportAssetGroupKey;
          const criteriaGroupKey = criteria?.portfolioImportAssetGroupKey?.portfolioImportAssetGroupKey;
          if (criteriaGroupKey !== undefined && candidateGroupKey !== criteriaGroupKey) return false;
          if (criteria?.portfolioImportAssetGroupKey !== undefined && criteriaGroupKey === undefined) return candidate.portfolioImportAssetGroupKey === criteria.portfolioImportAssetGroupKey;
          return true;
        }));
        if (entity === PortfolioImportRow) {
          return Promise.resolve(state.rows.filter((row) => {
            if (criteria?.deletedAt !== undefined && row.deletedAt !== criteria.deletedAt) return false;
            if (sessionKey !== undefined && row.portfolioImportSessionKey.portfolioImportSessionKey !== sessionKey) return false;
            if (criteria?.assetGroupKey?.$in) return criteria.assetGroupKey.$in.includes(row.assetGroupKey);
            if (criteria?.assetGroupKey !== undefined) return row.assetGroupKey === criteria.assetGroupKey;
            return true;
          }));
        }
        return Promise.resolve([]);
      }),
      findOne: vi.fn().mockImplementation((entity, criteria) => {
        if (entity === PortfolioImportSession) return Promise.resolve(state.session);
        if (entity === PortfolioImportAssetGroup) return Promise.resolve(state.groups.find((group) => group.portfolioImportAssetGroupKey === criteria?.portfolioImportAssetGroupKey && (criteria?.portfolioImportSessionKey?.portfolioImportSessionKey ?? criteria?.portfolioImportSessionKey) === group.portfolioImportSessionKey.portfolioImportSessionKey) ?? null);
        if (entity === PortfolioImportAssetCandidate) return Promise.resolve(state.candidates.find((candidate) => {
          if (candidate.portfolioImportAssetCandidateKey !== criteria?.portfolioImportAssetCandidateKey) return false;
          const candidateGroupKey = candidate.portfolioImportAssetGroupKey.portfolioImportAssetGroupKey;
          const criteriaGroupKey = criteria?.portfolioImportAssetGroupKey?.portfolioImportAssetGroupKey;
          if (criteriaGroupKey !== undefined) return candidateGroupKey === criteriaGroupKey;
          if (criteria?.portfolioImportAssetGroupKey !== undefined) return candidate.portfolioImportAssetGroupKey === criteria.portfolioImportAssetGroupKey;
          return true;
        }) ?? null);
        if (entity === FinancialAsset) return Promise.resolve(state.financialAssets.find((item) => item.financialAssetKey === criteria?.financialAssetKey) ?? null);
        return Promise.resolve(null);
      }),
      flush,
      persist: vi.fn().mockImplementation((value: unknown) => { persisted.push(value); return { flush }; }),
      transactional: vi.fn((callback: (em: typeof DI.em) => Promise<unknown>) => Promise.resolve(callback(Object.assign({}, DI.em, { transactional: vi.fn() }) as typeof DI.em))),
    });
    return { persisted, state };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrCreateFinancialAssetMock.mockReset();
    getOwnedSessionMock.mockReset();
    saveReusableMappingMock.mockReset();
  });

  it('rejects invalid session status', async () => {
    setup({ sessionStatus: PortfolioImportSessionStatus.UPLOADED });
    await expect(service.confirmAssetMappings({ appuser, decisions: [], importSessionId: 10, tenant })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects duplicate decisions and unknown groups', async () => {
    setup();
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 101 }, { action: 'skip_group', groupId: 101 }], importSessionId: 10, tenant })).rejects.toThrow('Duplicate asset group decision');
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 999 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('use_candidate resolves asset and updates group rows', async () => {
    const { persisted, state } = setup();
    saveReusableMappingMock.mockResolvedValue(undefined);
    const result = await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 201, groupId: 101 }], importSessionId: 10, tenant });

    expect(resolveOrCreateFinancialAssetMock).toHaveBeenCalledWith('AAPL', { skipStockSplitSync: true });
    expect(getOwnedSessionMock).toHaveBeenCalledWith({ appuser, importSessionId: 10, tenant }, { em: expect.anything() });
    expect((DI.em.findOne as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([entity, criteria]) => entity === PortfolioImportAssetCandidate && (criteria as { portfolioImportAssetCandidateKey?: number; portfolioImportAssetGroupKey?: PortfolioImportAssetGroup }).portfolioImportAssetCandidateKey === 201 && (criteria as { portfolioImportAssetGroupKey?: PortfolioImportAssetGroup }).portfolioImportAssetGroupKey === state.fixtures.group1)).toBe(true);
    expect(state.groups[0]).toMatchObject({ resolutionReason: 'user_selected_candidate', selectedAction: PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE, selectedFinancialAssetKey: state.fixtures.asset, status: PortfolioImportAssetGroupStatus.SELECTED });
    expect(state.rows[0]).toMatchObject({ financialAssetKey: state.fixtures.asset, status: PortfolioImportRowStatus.READY });
    expect(state.rows[1]).toMatchObject({ financialAssetKey: state.fixtures.asset, skipReason: undefined, status: PortfolioImportRowStatus.READY });
    expect(state.rows[2]).toMatchObject({ financialAssetKey: state.fixtures.asset, status: PortfolioImportRowStatus.READY });
    expect(state.rows[3]).toMatchObject({ skipReason: 'dup', status: PortfolioImportRowStatus.DUPLICATE });
    expect(result.summary).toMatchObject({ duplicateRows: 1, invalidRows: 1, keepMe: true, needsAssetReviewRows: 1, nested: { preserved: true }, readyRows: 4, skippedRows: 0 });
    expect(result.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(persisted.flat().some((value) => typeof value === 'object' && value !== null && ('portfolioImportRowKey' in value || 'financialAssetKey' in value))).toBe(true);
    expect(saveReusableMappingMock).toHaveBeenCalledWith(expect.objectContaining({ financialAsset: state.fixtures.asset, financialBroker: state.session.financialBrokerKey, identity: expect.any(Object), identityHash: expect.any(String), tenant: state.session.tenantKey }), expect.anything());
  });

  it('use_external_symbol resolves provider symbol and updates group rows', async () => {
    const externalAsset = { deletedAt: undefined, financialAssetKey: 401, symbol: 'TSLA' } as FinancialAsset;
    const { state } = setup({ financialAssets: [externalAsset] });
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(externalAsset);

    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_external_symbol', groupId: 101, symbol: 'TSLA' }], importSessionId: 10, tenant });

    expect(resolveOrCreateFinancialAssetMock).toHaveBeenCalledWith('TSLA', { skipStockSplitSync: true });
    expect(state.groups[0]).toMatchObject({ resolutionReason: 'user_selected_external_symbol', selectedAction: PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE, selectedFinancialAssetKey: externalAsset, status: PortfolioImportAssetGroupStatus.SELECTED });
    expect(state.rows[0]).toMatchObject({ financialAssetKey: externalAsset, status: PortfolioImportRowStatus.READY });
    expect(state.rows[1]).toMatchObject({ financialAssetKey: externalAsset, status: PortfolioImportRowStatus.READY });
    expect(saveReusableMappingMock).toHaveBeenCalledWith(expect.objectContaining({ financialAsset: externalAsset, financialBroker: state.session.financialBrokerKey, identity: expect.any(Object), identityHash: expect.any(String), tenant: state.session.tenantKey }), expect.anything());
  });

  it('use_external_symbol canonicalizes lowercase symbol before resolving', async () => {
    const externalAsset = { deletedAt: undefined, financialAssetKey: 402, symbol: 'TSLA' } as FinancialAsset;
    const { state } = setup({ financialAssets: [externalAsset] });
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(externalAsset);

    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_external_symbol', groupId: 101, symbol: 'tsla' }], importSessionId: 10, tenant });

    expect(resolveOrCreateFinancialAssetMock).toHaveBeenCalledWith('TSLA', { skipStockSplitSync: true });
    expect(state.groups[0]).toMatchObject({ resolutionReason: 'user_selected_external_symbol', selectedAction: PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE, selectedFinancialAssetKey: externalAsset, status: PortfolioImportAssetGroupStatus.SELECTED });
    expect(state.rows[0]).toMatchObject({ financialAssetKey: externalAsset, status: PortfolioImportRowStatus.READY });
    expect(state.rows[1]).toMatchObject({ financialAssetKey: externalAsset, status: PortfolioImportRowStatus.READY });
  });

  it('accepts candidate relation with matching group key but different object identity', async () => {
    const { state } = setup();
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 204, groupId: 101 }], importSessionId: 10, tenant })).resolves.toMatchObject({ status: PortfolioImportSessionStatus.PARTIAL });
    expect(resolveOrCreateFinancialAssetMock).toHaveBeenCalledWith('AAPL', { skipStockSplitSync: true });
    const group0 = state.groups[0];
    if (!group0) throw new Error('missing group');
    expect(group0.selectedAction).toBe(PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE);
  });

  it('use_existing_asset selects asset and skip_group marks skipped', async () => {
    const { state } = setup();
    saveReusableMappingMock.mockResolvedValue(undefined);
    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }, { action: 'skip_group', groupId: 102, skipReason: 'later' }], importSessionId: 10, tenant });

    expect(state.groups[0]).toMatchObject({ selectedAction: PortfolioImportAssetGroupSelectedAction.USE_EXISTING_ASSET, selectedFinancialAssetKey: state.fixtures.asset });
    expect(state.groups[1]).toMatchObject({ selectedAction: PortfolioImportAssetGroupSelectedAction.SKIP_GROUP, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.SKIPPED });
    expect(state.rows[4]).toMatchObject({ status: PortfolioImportRowStatus.INVALID });
    expect(saveReusableMappingMock).toHaveBeenCalledTimes(1);
  });

  it('does not persist reusable mappings for no-broker use_candidate or use_existing_asset sessions', async () => {
    const noBrokerCandidate = setup();
    noBrokerCandidate.state.session.financialBrokerKey = undefined;
    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 201, groupId: 101 }], importSessionId: 10, tenant });
    expect(saveReusableMappingMock).not.toHaveBeenCalled();

    saveReusableMappingMock.mockReset();

    const noBrokerExisting = setup();
    noBrokerExisting.state.session.financialBrokerKey = undefined;
    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant });
    expect(saveReusableMappingMock).not.toHaveBeenCalled();
  });

  it('rejects mapping conflicts before mutating groups or rows', async () => {
    const { persisted, state } = setup();
    saveReusableMappingMock.mockRejectedValueOnce(new ConflictError('Reusable asset mapping already points to a different asset'));

    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(ConflictError);
    expect(state.groups[0]?.status).toBe(PortfolioImportAssetGroupStatus.AMBIGUOUS);
    expect(state.groups[0]?.selectedAction).toBeUndefined();
    expect(state.groups[0]?.selectedFinancialAssetKey).toBeUndefined();
    expect(state.rows[0]?.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
    expect(state.rows[0]?.financialAssetKey).toBeUndefined();
    expect(persisted).toHaveLength(0);
  });

  it('repeated same-asset mapping confirmation is idempotent', async () => {
    const { state } = setup();
    saveReusableMappingMock.mockResolvedValue({ portfolioImportAssetMappingKey: 1 });

    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant });
    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant });

    expect(saveReusableMappingMock).toHaveBeenCalledTimes(2);
    expect(state.groups[0]).toMatchObject({ selectedAction: PortfolioImportAssetGroupSelectedAction.USE_EXISTING_ASSET, selectedFinancialAssetKey: state.fixtures.asset });
  });

  it('handles mixed selected and skipped decisions in one request', async () => {
    const { state } = setup();

    const result = await service.confirmAssetMappings({
      appuser,
      decisions: [
        { action: 'use_candidate', candidateId: 201, groupId: 101 },
        { action: 'skip_group', groupId: 102, skipReason: 'keep reviewing' },
      ],
      importSessionId: 10,
      tenant,
    });

    expect(state.groups[0]).toMatchObject({ selectedAction: PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE, selectedFinancialAssetKey: state.fixtures.asset, status: PortfolioImportAssetGroupStatus.SELECTED });
    expect(state.groups[1]).toMatchObject({ selectedAction: PortfolioImportAssetGroupSelectedAction.SKIP_GROUP, selectedFinancialAssetKey: undefined, status: PortfolioImportAssetGroupStatus.SKIPPED });
    expect(result.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    expect(result.summary).toMatchObject({ assetGroups: { selectedGroups: 1, skippedGroups: 1 }, keepMe: true, readyRows: 4, skippedRows: 0 });
  });

  it('recomputes session summary and keeps unrelated metadata', async () => {
    const { state } = setup();
    state.session.summaryJson = { assetResolutionError: 'err', columnMappingWarning: 'warn', customMeta: { hello: 'world' }, parseCorrelationId: 'corr-1' } as unknown as PortfolioImportSession['summaryJson'];

    const result = await service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 101 }], importSessionId: 10, tenant });

    expect(state.session.summaryJson).toMatchObject({ assetGroups: { skippedGroups: 1 }, assetResolutionError: 'err', columnMappingWarning: 'warn', customMeta: { hello: 'world' }, parseCorrelationId: 'corr-1' });
    expect(result.summary).toMatchObject({ assetGroups: { skippedGroups: 1 }, assetResolutionError: 'err', columnMappingWarning: 'warn', customMeta: { hello: 'world' }, parseCorrelationId: 'corr-1' });
  });

  it('leaves unrelated groups unchanged', async () => {
    const { state } = setup();
    const untouchedGroup = state.groups[1];
    if (!untouchedGroup) throw new Error('missing group');

    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 101 }], importSessionId: 10, tenant });

    expect(untouchedGroup.status).toBe(PortfolioImportAssetGroupStatus.MATCHED);
    expect(untouchedGroup.selectedAction).toBeUndefined();
    expect(untouchedGroup.selectedFinancialAssetKey).toBeUndefined();
    expect(state.rows[4]).toMatchObject({ status: PortfolioImportRowStatus.INVALID });
    expect(state.rows[5]).toMatchObject({ status: PortfolioImportRowStatus.READY });
    expect(state.rows[6]).toMatchObject({ skipReason: 'pending', status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW });
  });

  it('does not include unrelated group rows in persist payload', async () => {
    const { persisted, state } = setup();

    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 101 }], importSessionId: 10, tenant });

    const changedRowKeys = persisted
      .flat()
      .filter((value): value is { portfolioImportRowKey?: number } => typeof value === 'object' && value !== null && 'portfolioImportRowKey' in value)
      .map((value) => value.portfolioImportRowKey);

    expect(changedRowKeys).toContain(1);
    expect(changedRowKeys).toContain(2);
    expect(changedRowKeys).toContain(3);
    expect(changedRowKeys).not.toContain(6);
    expect(changedRowKeys).not.toContain(7);
    expect(state.rows[5]).toMatchObject({ status: PortfolioImportRowStatus.READY });
    expect(state.rows[6]).toMatchObject({ status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW });
  });

  it('rejects invalid candidate and foreign candidate and missing symbol and invalid asset', async () => {
    setup();
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 999, groupId: 101 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 203, groupId: 101 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 202, groupId: 101 }], importSessionId: 10, tenant })).rejects.toThrow('Candidate symbol is required');
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 999, groupId: 101 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('supports re-editing selected and skipped groups and recomputes status', async () => {
    const { state } = setup({ sessionStatus: PortfolioImportSessionStatus.PARTIAL });
    const group0 = state.groups[0];
    const rowA0 = state.rows[0];
    const rowA1 = state.rows[1];
    const rowA2 = state.rows[2];
    if (!group0 || !rowA0 || !rowA1 || !rowA2) throw new Error('missing state');
    group0.status = PortfolioImportAssetGroupStatus.SELECTED;
    group0.selectedAction = PortfolioImportAssetGroupSelectedAction.SKIP_GROUP;
    rowA0.status = PortfolioImportRowStatus.SKIPPED;
    rowA0.skipReason = 'user skipped';
    rowA1.status = PortfolioImportRowStatus.SKIPPED;
    rowA2.status = PortfolioImportRowStatus.READY;

    const result = await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 201, groupId: 101 }], importSessionId: 10, tenant });
    expect(result.status).toBe(PortfolioImportSessionStatus.PARTIAL);
    const row0 = state.rows[0]!;
    expect(row0.status).toBe(PortfolioImportRowStatus.READY);
    expect(row0.skipReason).toBeUndefined();
  });

  it('validates all decisions before calling the resolver or mutating state', async () => {
    const { state } = setup();
    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 201, groupId: 101 }, { action: 'use_existing_asset', financialAssetId: 999, groupId: 102 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(NotFoundError);
    expect(resolveOrCreateFinancialAssetMock).not.toHaveBeenCalled();
    const group0 = state.groups[0];
    const rowB0 = state.rows[0];
    if (!group0 || !rowB0) throw new Error('missing state');
    expect(group0.status).toBe(PortfolioImportAssetGroupStatus.AMBIGUOUS);
    expect(rowB0.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
  });

  it('does not mutate or persist if a later candidate resolution fails', async () => {
    const { persisted, state } = setup();
    resolveOrCreateFinancialAssetMock.mockResolvedValueOnce(state.fixtures.asset).mockRejectedValueOnce(new Error('resolver boom'));

    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_candidate', candidateId: 201, groupId: 101 }, { action: 'use_candidate', candidateId: 203, groupId: 102 }], importSessionId: 10, tenant })).rejects.toThrow('resolver boom');
    const group0 = state.groups[0];
    const row0 = state.rows[0];
    if (!group0 || !row0) throw new Error('missing state');
    expect(group0.status).toBe(PortfolioImportAssetGroupStatus.AMBIGUOUS);
    expect(row0.status).toBe(PortfolioImportRowStatus.NEEDS_ASSET_REVIEW);
    expect(persisted).toHaveLength(0);
    expect((DI.em.transactional as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(0);
  });

  it('sets ready_to_import or needs_asset_review based on remaining groups', async () => {
    const readySetup = setup({ rows: [
      { assetGroupKey: undefined, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 1, portfolioImportSessionKey: undefined, rowNumber: 1, skipReason: undefined, status: PortfolioImportRowStatus.READY },
      { assetGroupKey: undefined, deletedAt: undefined, financialAssetKey: undefined, portfolioImportRowKey: 2, portfolioImportSessionKey: undefined, rowNumber: 2, skipReason: undefined, status: PortfolioImportRowStatus.READY },
    ] as unknown as PortfolioImportRow[] });
    const readyGroup0 = readySetup.state.groups[0];
    const readyGroup1 = readySetup.state.groups[1];
    if (!readyGroup0 || !readyGroup1) throw new Error('missing ready groups');
    readySetup.state.rows.forEach((row) => { row.assetGroupKey = readyGroup0; row.portfolioImportSessionKey = readySetup.state.session; });
    readyGroup0.status = PortfolioImportAssetGroupStatus.MATCHED;
    readyGroup1.status = PortfolioImportAssetGroupStatus.SELECTED;
    const readyResult = await service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant });
    expect(readyResult.status).toBe(PortfolioImportSessionStatus.READY_TO_IMPORT);

    const reviewSetup = setup();
    const reviewGroup0 = reviewSetup.state.groups[0];
    const reviewGroup1 = reviewSetup.state.groups[1];
    if (!reviewGroup0 || !reviewGroup1) throw new Error('missing review groups');
    reviewGroup0.status = PortfolioImportAssetGroupStatus.AMBIGUOUS;
    reviewGroup1.status = PortfolioImportAssetGroupStatus.MATCHED;
    reviewSetup.state.rows.forEach((row) => { if (row.status !== PortfolioImportRowStatus.DUPLICATE && row.status !== PortfolioImportRowStatus.INVALID && row.status !== PortfolioImportRowStatus.IMPORTED && row.status !== PortfolioImportRowStatus.FAILED) row.status = PortfolioImportRowStatus.READY; });
    const reviewResult = await service.confirmAssetMappings({ appuser, decisions: [], importSessionId: 10, tenant });
    expect(reviewResult.status).toBe(PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW);
  });

  it('preserves unrelated summary metadata and does not persist transactions', async () => {
    const { persisted, state } = setup();
    state.session.summaryJson = { keepMe: true, nested: { preserved: true }, unrelated: { x: 1 } } as unknown as PortfolioImportSession['summaryJson'];
    await service.confirmAssetMappings({ appuser, decisions: [{ action: 'skip_group', groupId: 101 }], importSessionId: 10, tenant });
    expect(state.session.summaryJson).toMatchObject({ keepMe: true, unrelated: { x: 1 } });
    expect(persisted.some((value) => typeof value === 'object' && value !== null && 'financialTransactionKey' in value)).toBe(false);
  });

  it('uses a transaction and rolls back on failure before mutation', async () => {
    const { persisted, state } = setup();
    const findOneMock = vi.fn().mockImplementationOnce((entity) => {
      if (entity === PortfolioImportSession) return Promise.resolve(state.session);
      return Promise.resolve(null);
    }).mockImplementationOnce(() => Promise.resolve(null));
    Object.assign(DI.em, { findOne: findOneMock });

    await expect(service.confirmAssetMappings({ appuser, decisions: [{ action: 'use_existing_asset', financialAssetId: 301, groupId: 101 }], importSessionId: 10, tenant })).rejects.toBeInstanceOf(NotFoundError);
    expect((DI.em.transactional as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(0);
    expect(persisted).toHaveLength(0);
    expect(state.groups[0]?.status).toBe(PortfolioImportAssetGroupStatus.AMBIGUOUS);
  });
});
