import * as Sentry from '@sentry/node';

import { DI } from '@app/database/di';
import { FinancialAsset } from '@entity/FinancialAsset';
import { PortfolioImportAssetCandidate } from '@entity/PortfolioImportAssetCandidate';
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupSelectedAction, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import eodhd from '@service/market-data/eodhd.service';
import { ConflictError } from '@utils/errors';
import logger from '@utils/logger';

import portfolioImportAssetMappingReuseService from './portfolio-import-asset-mapping-reuse.service';
import {
  buildPortfolioImportAssetIdentityHash,
  extractPortfolioImportAssetIdentity,
  scorePortfolioImportAssetCandidate,
} from './portfolio-import-asset-resolution.utils';
import { buildImportSessionSummary, canConfirm } from './portfolio-import-session-state';

export interface AssetSearchCandidate {
  Code?: string;
  Country?: string;
  Currency?: string;
  Exchange?: string;
  ISIN?: string;
  Name?: string;
  profileJson?: Record<string, unknown>;
  Type?: string;
}

export interface PortfolioImportAssetResolutionDeps {
  search?: (query: string) => Promise<AssetSearchCandidate[]>;
}

export interface PortfolioImportAssetResolutionResult {
  ambiguousGroups: number;
  matchedGroups: number;
  providerErrorGroups: number;
  status: PortfolioImportSessionStatus;
  totalGroups: number;
  unmatchedGroups: number;
}

export interface ProviderLookupContext {
  affectedRowCount?: number;
  affectedRowNumbers?: number[];
  brokerAssetName?: string;
  brokerExchange?: string;
  brokerId?: number;
  brokerTicker?: string;
  currency?: string;
  importSessionId: number;
  isin?: string;
  lookupType: 'isin' | 'name' | 'symbol';
  lookupValue: string;
  provider: 'eodhd';
  tenantId?: number;
}

const PROVIDER_HIGH_CONFIDENCE = 0.95;
const UNSUPPORTED_ASSET_REASON = 'Unsupported asset';
const eodhdSearch = eodhd as unknown as { search: (query: string) => Promise<AssetSearchCandidate[]> };

class PortfolioImportAssetResolutionService {
  async resolveImportSessionAssets(input: { importSessionId: number }, deps: PortfolioImportAssetResolutionDeps = {}): Promise<PortfolioImportAssetResolutionResult> {
    const searchCache = new Map<string, Promise<AssetSearchCandidate[]>>();
    let providerConcurrency = 0;
    const maxProviderConcurrency = 4;
    const session = await DI.em.findOne(PortfolioImportSession, { deletedAt: undefined, portfolioImportSessionKey: input.importSessionId }, { populate: ['portfolioKey', 'tenantKey', 'financialBrokerKey'] });
    if (!session) throw new Error('Import session not found');
    if ([
      PortfolioImportSessionStatus.CANCELLED,
      PortfolioImportSessionStatus.EXPIRED,
      PortfolioImportSessionStatus.FAILED,
      PortfolioImportSessionStatus.IMPORTING,
      PortfolioImportSessionStatus.PARSING,
      PortfolioImportSessionStatus.SUCCEEDED,
      PortfolioImportSessionStatus.WAITING_FOR_UPLOAD,
    ].includes(session.status)) {
      throw new ConflictError('Import session assets cannot be resolved');
    }

    const rows = await DI.em.find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: session }, { populate: ['assetGroupKey', 'financialAssetKey'] });

    const cleanedRows = new Set<PortfolioImportRow>();
    for (const row of rows) {
      if (row.status === PortfolioImportRowStatus.SKIPPED && row.skipReason === UNSUPPORTED_ASSET_REASON) {
        row.status = PortfolioImportRowStatus.READY;
        row.skipReason = undefined;
      }
      if (row.status === PortfolioImportRowStatus.READY || row.status === PortfolioImportRowStatus.NEEDS_ASSET_REVIEW) {
        row.assetGroupKey = undefined;
        row.financialAssetKey = undefined;
        cleanedRows.add(row);
      }
    }

    const groupedRows = new Map<string, { identity: NonNullable<ReturnType<typeof extractPortfolioImportAssetIdentity>>; rows: PortfolioImportRow[] }>();
    for (const row of rows) {
      const identity = extractPortfolioImportAssetIdentity(row.normalizedJson);
      if (!identity) continue;
      const hash = buildPortfolioImportAssetIdentityHash(identity);
      const entry = groupedRows.get(hash) ?? { identity, rows: [] };
      entry.rows.push(row);
      groupedRows.set(hash, entry);
    }

    const existingGroups = await DI.em.find(PortfolioImportAssetGroup, { deletedAt: undefined, portfolioImportSessionKey: session });
    const previouslyUnsupportedIdentityHashes = new Set(existingGroups.filter((group) => group.resolutionReason === 'unsupported_asset').map((group) => group.identityHash));
    const existingCandidates = existingGroups.length > 0
      ? await DI.em.find(PortfolioImportAssetCandidate, { deletedAt: undefined, portfolioImportAssetGroupKey: existingGroups })
      : [];
    for (const entity of [...existingCandidates, ...existingGroups]) entity.deletedAt = new Date();

    let matchedGroups = 0;
    let ambiguousGroups = 0;
    let unmatchedGroups = 0;
    let providerErrorGroups = 0;
    let hasNeedsReview = false;
    const unsupportedAssets: { skippedRows: number; symbol: string }[] = [];

    const persisted: (PortfolioImportAssetCandidate | PortfolioImportAssetGroup | PortfolioImportRow | PortfolioImportSession)[] = [...existingCandidates, ...existingGroups];

    for (const { identity, rows: groupRows } of groupedRows.values()) {
      const group = Object.assign(new PortfolioImportAssetGroup(), {
        brokerAssetName: identity.brokerAssetName,
        brokerExchange: identity.brokerExchange,
        brokerTicker: identity.brokerTicker,
        currency: identity.currency,
        identityHash: buildPortfolioImportAssetIdentityHash(identity),
        isin: identity.isin,
        portfolioImportSessionKey: session,
      });

      groupRows.forEach((row) => { row.assetGroupKey = group; });

      const reusableAsset = await portfolioImportAssetMappingReuseService.findReusableAsset({
        financialBroker: session.financialBrokerKey,
        identity,
        identityHash: group.identityHash,
        tenant: session.tenantKey,
      });
      if (reusableAsset) {
        group.status = PortfolioImportAssetGroupStatus.MATCHED;
        group.selectedFinancialAssetKey = reusableAsset;
        group.resolutionReason = 'reusable_mapping';
        matchedGroups++;
        for (const row of groupRows) {
          if (row.status === PortfolioImportRowStatus.READY) row.financialAssetKey = reusableAsset;
        }
        persisted.push(group, ...groupRows);
        continue;
      }

      const localMatch = await this.findLocalMatch(identity);
      if (localMatch) {
        group.status = PortfolioImportAssetGroupStatus.MATCHED;
        group.selectedFinancialAssetKey = localMatch;
        group.resolutionReason = 'local_exact_match';
        matchedGroups++;
        for (const row of groupRows) {
          if (row.status === PortfolioImportRowStatus.READY) row.financialAssetKey = localMatch;
        }
        persisted.push(group, ...groupRows);
        continue;
      }

      const searchResult = await this.searchCandidates(identity, deps, searchCache, () => providerConcurrency, (next) => { providerConcurrency = next; }, maxProviderConcurrency, {
        affectedRowCount: groupRows.length,
        affectedRowNumbers: groupRows.map((row) => row.rowNumber).filter((rowNumber): rowNumber is number => typeof rowNumber === 'number'),
        brokerAssetName: identity.brokerAssetName,
        brokerExchange: identity.brokerExchange,
        brokerId: session.financialBrokerKey?.financialBrokerKey,
        brokerTicker: identity.brokerTicker,
        currency: identity.currency,
        importSessionId: input.importSessionId,
        isin: identity.isin,
        lookupType: identity.isin ? 'isin' : identity.brokerTicker ? 'symbol' : 'name',
        lookupValue: identity.isin ?? identity.brokerTicker ?? identity.brokerAssetName ?? '',
        provider: 'eodhd',
        tenantId: session.tenantKey.tenantKey,
      });
      if ('kind' in searchResult) {
        group.status = PortfolioImportAssetGroupStatus.PROVIDER_ERROR;
        group.resolutionReason = 'provider_error';
        providerErrorGroups++;
        hasNeedsReview = true;
        for (const row of groupRows) {
          if (row.status === PortfolioImportRowStatus.READY) row.status = PortfolioImportRowStatus.NEEDS_ASSET_REVIEW;
        }
        persisted.push(group, ...groupRows);
        continue;
      }

      const scored = searchResult.candidates.map((candidate: AssetSearchCandidate) => ({
        candidate,
        score: scorePortfolioImportAssetCandidate(identity, {
          currency: candidate.Currency,
          exchange: candidate.Exchange,
          isin: candidate.ISIN,
          name: candidate.Name,
          symbol: candidate.Code,
        }),
      }));
      const usable = scored.filter(({ score }) => score.confidence > 0 && !score.rejectedReason);
      for (const { candidate, score } of scored) {
        const entity = Object.assign(new PortfolioImportAssetCandidate(), {
          confidence: score.confidence,
          currency: candidate.Currency,
          exchange: candidate.Exchange,
          hasPriceHistory: false,
          isin: candidate.ISIN,
          name: candidate.Name,
          portfolioImportAssetGroupKey: group,
          profileJson: candidate.profileJson,
          provider: 'eodhd',
          rejectedReason: score.rejectedReason,
          symbol: candidate.Code,
        });
        persisted.push(entity);
      }

      const highConfidence = usable.filter(({ score }) => score.confidence >= PROVIDER_HIGH_CONFIDENCE);
      if (highConfidence.length === 1 && scored.filter(({ score }) => score.confidence > 0 && !score.rejectedReason).length === 1) {
        const [best] = highConfidence;
        if (!best) {
          group.status = PortfolioImportAssetGroupStatus.AMBIGUOUS;
          group.resolutionReason = 'provider_high_confidence_needs_review';
          ambiguousGroups++;
          hasNeedsReview = true;
          persisted.push(group, ...groupRows);
          continue;
        }
        const localProviderMatch = await this.findProviderLocalMatch(identity, best.candidate);
        if (localProviderMatch) {
          group.status = PortfolioImportAssetGroupStatus.MATCHED;
          group.selectedFinancialAssetKey = localProviderMatch;
          group.resolutionReason = 'provider_high_confidence_local_match';
          matchedGroups++;
          for (const row of groupRows) {
            if (row.status === PortfolioImportRowStatus.READY) row.financialAssetKey = localProviderMatch;
          }
          persisted.push(group, ...groupRows);
          continue;
        } else {
          group.status = PortfolioImportAssetGroupStatus.AMBIGUOUS;
          group.resolutionReason = 'provider_high_confidence_needs_review';
          ambiguousGroups++;
          hasNeedsReview = true;
          for (const row of groupRows) {
            if (row.status === PortfolioImportRowStatus.READY) row.status = PortfolioImportRowStatus.NEEDS_ASSET_REVIEW;
          }
        }
      } else if (scored.length === 0) {
        group.status = PortfolioImportAssetGroupStatus.SKIPPED;
        group.selectedAction = PortfolioImportAssetGroupSelectedAction.SKIP_GROUP;
        group.selectedFinancialAssetKey = undefined;
        group.resolutionReason = 'unsupported_asset';
        unmatchedGroups++;
        const symbol = this.getUnsupportedAssetSymbol(identity);
        let skippedRows = 0;
        for (const row of groupRows) {
          if (![PortfolioImportRowStatus.NEEDS_ASSET_REVIEW, PortfolioImportRowStatus.READY, PortfolioImportRowStatus.VALID].includes(row.status)) continue;
          row.status = PortfolioImportRowStatus.SKIPPED;
          row.skipReason = UNSUPPORTED_ASSET_REASON;
          row.financialAssetKey = undefined;
          skippedRows++;
        }
        unsupportedAssets.push({ skippedRows, symbol });
        if (!previouslyUnsupportedIdentityHashes.has(group.identityHash)) this.captureUnsupportedAssetWarning({ group, importSessionId: input.importSessionId, rowCount: skippedRows, session, symbol });
      } else {
        group.status = PortfolioImportAssetGroupStatus.AMBIGUOUS;
        ambiguousGroups++;
        hasNeedsReview = true;
        for (const row of groupRows) {
          if (row.status === PortfolioImportRowStatus.READY) row.status = PortfolioImportRowStatus.NEEDS_ASSET_REVIEW;
        }
      }
      persisted.push(group, ...groupRows);
    }

    for (const row of cleanedRows) {
      if (!persisted.includes(row)) persisted.push(row);
    }

    const totalGroups = groupedRows.size;
    // Consolidated: row counts come from the shared session-state helper.
    const { duplicateRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows } = buildImportSessionSummary(rows, []);
    const allUnsupported = readyRows === 0 && needsAssetReviewRows === 0 && unsupportedAssets.length > 0;
    if (session.status !== PortfolioImportSessionStatus.FAILED) {
      if (hasNeedsReview) session.status = PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW;
      else if (readyRows > 0 && skippedRows > 0) session.status = PortfolioImportSessionStatus.PARTIAL;
      else if (readyRows > 0) session.status = PortfolioImportSessionStatus.READY_TO_IMPORT;
      else session.status = PortfolioImportSessionStatus.FAILED;
    }

    session.summaryJson = {
      ...(session.summaryJson ?? {}),
      assetGroups: { ambiguousGroups, matchedGroups, providerErrorGroups, skippedGroups: unsupportedAssets.length, totalGroups, unmatchedGroups },
      blockingRows: duplicateRows + invalidRows + skippedRows,
      canConfirm: false,
      duplicateRows,
      ...(allUnsupported ? { failureReason: 'No supported assets were found', terminalKind: 'failed' } : {}),
      importableRows: readyRows,
      invalidRows,
      needsAssetReviewRows,
      readyRows,
      skippedRows,
      status: session.status,
      totalRows: rows.length,
      unsupportedAssets,
    };
    // Consolidated: use the shared transitions confirm rule (stricter than the old
    // `readyRows > 0`) instead of the per-module copy. Needs the summary persisted
    // above first so the predicate can read ready/needs-review counts.
    session.summaryJson['canConfirm'] = canConfirm(session);

    persisted.push(session);
    await DI.em.persist(persisted).flush();

    return { ambiguousGroups, matchedGroups, providerErrorGroups, status: session.status, totalGroups, unmatchedGroups };
  }

  private captureUnsupportedAssetWarning(input: { group: PortfolioImportAssetGroup; importSessionId: number; rowCount: number; session: PortfolioImportSession; symbol: string }) {
    Sentry.captureMessage('Portfolio import unsupported asset skipped', {
      extra: { brokerId: input.session.financialBrokerKey?.financialBrokerKey, identityHash: input.group.identityHash, importSessionId: input.importSessionId, rowCount: input.rowCount, symbol: input.symbol, tenantId: input.session.tenantKey.tenantKey },
      level: 'warning',
      tags: { stage: 'portfolio-import-asset-resolution' },
    });
  }

  private async findLocalMatch(identity: NonNullable<ReturnType<typeof extractPortfolioImportAssetIdentity>>) {
    if (identity.isin) {
      const exactIsin = await DI.em.findOne(FinancialAsset, { deletedAt: undefined, isin: identity.isin });
      if (exactIsin) return exactIsin;
    }
    if (identity.brokerTicker && (identity.brokerExchange || identity.currency)) {
      const matches = await DI.em.find(FinancialAsset, { deletedAt: undefined, symbol: identity.brokerTicker }, { populate: ['currencyKey', 'financialAssetExchangeKey'] });
      const compatible = matches.filter((asset) => (
        (!identity.currency || asset.currencyKey?.code === identity.currency)
        && (!identity.brokerExchange || asset.financialAssetExchangeKey?.acronym === identity.brokerExchange || asset.financialAssetExchangeKey?.name === identity.brokerExchange)
      ));
      if (compatible.length === 1) return compatible[0];
    }
    return undefined;
  }

  private async findProviderLocalMatch(identity: NonNullable<ReturnType<typeof extractPortfolioImportAssetIdentity>>, candidate: AssetSearchCandidate) {
    if (candidate.ISIN) {
      const exactIsin = await DI.em.findOne(FinancialAsset, { deletedAt: undefined, isin: candidate.ISIN });
      if (exactIsin) return exactIsin;
    }

    if (!candidate.Code) return undefined;

    const evidenceExchange = candidate.Exchange ?? identity.brokerExchange;
    const evidenceCurrency = candidate.Currency ?? identity.currency;
    if (!evidenceExchange && !evidenceCurrency) return undefined;

    const matches = await DI.em.find(FinancialAsset, { deletedAt: undefined, symbol: candidate.Code }, { populate: ['currencyKey', 'financialAssetExchangeKey'] });
    const compatible = matches.filter((asset) => (
      (!evidenceCurrency || asset.currencyKey?.code === evidenceCurrency)
      && (!evidenceExchange || asset.financialAssetExchangeKey?.acronym === evidenceExchange || asset.financialAssetExchangeKey?.name === evidenceExchange)
    ));
    return compatible.length === 1 ? compatible[0] : undefined;
  }

  private getUnsupportedAssetSymbol(identity: NonNullable<ReturnType<typeof extractPortfolioImportAssetIdentity>>) {
    return (identity.brokerTicker ?? identity.isin ?? identity.brokerAssetName ?? 'Unknown asset').slice(0, 120);
  }

  private logProviderLookupFailure(error: unknown, context: ProviderLookupContext) {
    logger.error({ error, ...context }, 'Portfolio import asset provider lookup failed');
    Sentry.captureException(error, {
      extra: { ...context },
      level: 'error',
      tags: { lookupType: context.lookupType, provider: context.provider, stage: 'portfolio-import-asset-resolution' },
    });
  }

  private async runWithConcurrency<T>(task: () => Promise<T>, getConcurrency: () => number, setConcurrency: (value: number) => void, maxProviderConcurrency: number): Promise<T> {
    while (getConcurrency() >= maxProviderConcurrency) await new Promise((resolve) => setTimeout(resolve, 0));
    setConcurrency(getConcurrency() + 1);
    try { return await task(); } finally { setConcurrency(getConcurrency() - 1); }
  }

  private async searchCandidates(identity: NonNullable<ReturnType<typeof extractPortfolioImportAssetIdentity>>, deps: PortfolioImportAssetResolutionDeps, searchCache: Map<string, Promise<AssetSearchCandidate[]>>, getConcurrency: () => number, setConcurrency: (value: number) => void, maxProviderConcurrency: number, context: ProviderLookupContext): Promise<{ candidates: AssetSearchCandidate[] } | { kind: 'provider_error' }> {
    const cacheKey = JSON.stringify([identity.isin ?? '', identity.brokerTicker ?? '', identity.brokerExchange ?? '', identity.brokerAssetName ?? '', identity.currency ?? '']);
    const cached = searchCache.get(cacheKey);
    if (cached) {
      try { return { candidates: await cached }; } catch (error) { this.logProviderLookupFailure(error, context); return { kind: 'provider_error' }; }
    }
    const search = deps.search ?? eodhdSearch.search.bind(eodhdSearch);

    const searchPromise = this.runWithConcurrency(async () => {
      try {
        const query = identity.isin ?? identity.brokerTicker ?? identity.brokerAssetName;
        if (!query) return [];
        const candidates = await search(query);
        return Array.isArray(candidates) ? candidates : [];
      } catch (error) {
        this.logProviderLookupFailure(error, context);
        throw error;
      }
    }, getConcurrency, setConcurrency, maxProviderConcurrency);
    searchCache.set(cacheKey, searchPromise);
    try { return { candidates: await searchPromise }; } catch { searchCache.delete(cacheKey); return { kind: 'provider_error' }; }
  }
}

export default new PortfolioImportAssetResolutionService();
