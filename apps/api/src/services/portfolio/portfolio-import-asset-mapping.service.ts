import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { PortfolioImportAssetCandidate } from '@entity/PortfolioImportAssetCandidate';
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupSelectedAction, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

import portfolioImportAssetMappingReuseService from './portfolio-import-asset-mapping-reuse.service';
import { buildPortfolioImportAssetIdentityHash, type PortfolioImportAssetIdentity } from './portfolio-import-asset-resolution.utils';
import { buildImportSessionSummary, type ImportSessionSummary, recomputeImportSessionStatus } from './portfolio-import-session-state';
import portfolioImportSessionService from './portfolio-import-session.service';

export interface ConfirmPortfolioImportAssetMappingsInput {
  appuser: Appuser;
  decisions: PortfolioImportAssetMappingDecision[];
  importSessionId: number;
  tenant: { tenantKey: number };
}

export interface ConfirmPortfolioImportAssetMappingsResult {
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  summary: ImportSessionSummary;
}

export type PortfolioImportAssetMappingDecision =
  | { action: 'skip_group'; groupId: number; skipReason?: string }
  | { action: 'use_candidate'; candidateId: number; groupId: number }
  | { action: 'use_existing_asset'; financialAssetId: number; groupId: number }
  | { action: 'use_external_symbol'; groupId: number; symbol: string };

class PortfolioImportAssetMappingService {
  async confirmAssetMappings(input: ConfirmPortfolioImportAssetMappingsInput): Promise<ConfirmPortfolioImportAssetMappingsResult> {
    return DI.em.transactional(async (em) => {
      const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em });
      if (![PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW, PortfolioImportSessionStatus.PARTIAL, PortfolioImportSessionStatus.READY_TO_IMPORT].includes(session.status)) {
        throw new ConflictError('Import session asset mappings cannot be changed');
      }

      const uniqueGroupIds = [...new Set(input.decisions.map((decision) => decision.groupId))];
      if (uniqueGroupIds.length !== input.decisions.length) throw new BadRequestError('Duplicate asset group decision');

      const allGroups = await em.find(PortfolioImportAssetGroup, { deletedAt: undefined, portfolioImportSessionKey: session });
      const groupById = new Map(allGroups.map((group) => [group.portfolioImportAssetGroupKey, group]));
      const groups = uniqueGroupIds.map((groupId) => {
        const group = groupById.get(groupId);
        if (!group) throw new NotFoundError('Asset group not found');
        return group;
      });

      const allRows = await em.find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: session });
      const affectedRows = allRows.filter((row) => {
        const rowGroup = row.assetGroupKey;
        const rowGroupKey = rowGroup?.portfolioImportAssetGroupKey;
        return rowGroupKey !== undefined && uniqueGroupIds.includes(rowGroupKey);
      });
      const plannedActions: { asset?: FinancialAsset; candidateSymbol?: string; decision: PortfolioImportAssetMappingDecision; group: PortfolioImportAssetGroup }[] = [];

      for (const decision of input.decisions) {
        const group = groupById.get(decision.groupId);
        if (!group) throw new NotFoundError('Asset group not found');
        if (decision.action === 'use_candidate') {
          const candidate = await em.findOne(PortfolioImportAssetCandidate, { deletedAt: undefined, portfolioImportAssetCandidateKey: decision.candidateId, portfolioImportAssetGroupKey: group });
          const candidateGroupKey = candidate?.portfolioImportAssetGroupKey.portfolioImportAssetGroupKey;
          if (!candidate || candidateGroupKey !== group.portfolioImportAssetGroupKey) throw new BadRequestError('Asset candidate not found for group');
          if (!candidate.symbol) throw new BadRequestError('Candidate symbol is required');
          plannedActions.push({ candidateSymbol: candidate.symbol, decision, group });
        } else if (decision.action === 'use_external_symbol') {
          plannedActions.push({ candidateSymbol: decision.symbol, decision, group });
        } else if (decision.action === 'use_existing_asset') {
          const asset = await em.findOne(FinancialAsset, { deletedAt: undefined, financialAssetKey: decision.financialAssetId });
          if (!asset) throw new NotFoundError('Financial asset not found');
          plannedActions.push({ asset, decision, group });
        } else {
          plannedActions.push({ decision, group });
        }
      }

      for (const action of plannedActions) {
        if (action.decision.action === 'use_candidate' || action.decision.action === 'use_external_symbol') action.asset = await resolveSymbolAsset(action.candidateSymbol!, em);
      }

      if (session.financialBrokerKey) {
        for (const action of plannedActions) {
          if (action.decision.action === 'skip_group') continue;

          const identity = this.identityFromGroup(action.group);
          const identityHash = action.group.identityHash || buildPortfolioImportAssetIdentityHash(identity);
          await portfolioImportAssetMappingReuseService.saveReusableMapping({
            financialAsset: action.asset!,
            financialBroker: session.financialBrokerKey,
            identity,
            identityHash,
            tenant: session.tenantKey,
          }, em);
        }
      }

      for (const action of plannedActions) {
        const group = action.group;
        if (action.decision.action === 'use_candidate' || action.decision.action === 'use_external_symbol') {
          group.status = PortfolioImportAssetGroupStatus.SELECTED;
          group.selectedAction = PortfolioImportAssetGroupSelectedAction.USE_CANDIDATE;
          group.selectedFinancialAssetKey = action.asset;
          group.resolutionReason = action.decision.action === 'use_external_symbol' ? 'user_selected_external_symbol' : 'user_selected_candidate';
          this.applyReadyAssetToRows(affectedRows, group, action.asset!, PortfolioImportRowStatus.READY);
        } else if (action.decision.action === 'use_existing_asset') {
          group.status = PortfolioImportAssetGroupStatus.SELECTED;
          group.selectedAction = PortfolioImportAssetGroupSelectedAction.USE_EXISTING_ASSET;
          group.selectedFinancialAssetKey = action.asset;
          group.resolutionReason = 'user_selected_existing_asset';
          this.applyReadyAssetToRows(affectedRows, group, action.asset!, PortfolioImportRowStatus.READY);
        } else {
          group.status = PortfolioImportAssetGroupStatus.SKIPPED;
          group.selectedAction = PortfolioImportAssetGroupSelectedAction.SKIP_GROUP;
          group.selectedFinancialAssetKey = undefined;
          group.resolutionReason = 'user_skipped_group';
          this.applySkippedRows(affectedRows, group, action.decision.skipReason ?? 'Asset group skipped by user');
        }
      }

      const summary = buildImportSessionSummary(allRows, allGroups);
      session.summaryJson = { ...(session.summaryJson ?? {}), ...summary };
      session.status = recomputeImportSessionStatus(allRows, allGroups);

      await em.persist([session, ...groups, ...affectedRows]).flush();
      return { importSessionId: session.portfolioImportSessionKey, status: session.status, summary: session.summaryJson as unknown as ConfirmPortfolioImportAssetMappingsResult['summary'] };
    });
  }

  private applyReadyAssetToRows(rows: PortfolioImportRow[], group: PortfolioImportAssetGroup, asset: FinancialAsset, nextStatus: PortfolioImportRowStatus.READY) {
    for (const row of rows) {
      const rowGroup = row.assetGroupKey;
      const rowGroupKey = rowGroup?.portfolioImportAssetGroupKey;
      if (rowGroup !== group && rowGroupKey !== group.portfolioImportAssetGroupKey) continue;
      if ([PortfolioImportRowStatus.DUPLICATE, PortfolioImportRowStatus.FAILED, PortfolioImportRowStatus.IMPORTED, PortfolioImportRowStatus.INVALID].includes(row.status)) continue;
      if ([PortfolioImportRowStatus.NEEDS_ASSET_REVIEW, PortfolioImportRowStatus.READY, PortfolioImportRowStatus.SKIPPED, PortfolioImportRowStatus.VALID].includes(row.status)) {
        row.status = nextStatus;
        row.financialAssetKey = asset;
        row.skipReason = undefined;
      }
    }
  }

  private applySkippedRows(rows: PortfolioImportRow[], group: PortfolioImportAssetGroup, skipReason: string) {
    for (const row of rows) {
      const rowGroup = row.assetGroupKey;
      const rowGroupKey = rowGroup?.portfolioImportAssetGroupKey;
      if (rowGroup !== group && rowGroupKey !== group.portfolioImportAssetGroupKey) continue;
      if ([PortfolioImportRowStatus.DUPLICATE, PortfolioImportRowStatus.FAILED, PortfolioImportRowStatus.IMPORTED, PortfolioImportRowStatus.INVALID].includes(row.status)) continue;
      if ([PortfolioImportRowStatus.NEEDS_ASSET_REVIEW, PortfolioImportRowStatus.READY, PortfolioImportRowStatus.SKIPPED, PortfolioImportRowStatus.VALID].includes(row.status)) {
        row.status = PortfolioImportRowStatus.SKIPPED;
        row.skipReason = skipReason;
        row.financialAssetKey = undefined;
      }
    }
  }

  private identityFromGroup(group: PortfolioImportAssetGroup): PortfolioImportAssetIdentity {
    return {
      brokerAssetName: group.brokerAssetName,
      brokerExchange: group.brokerExchange,
      brokerTicker: group.brokerTicker,
      currency: group.currency,
      isin: group.isin,
    };
  }
}

async function resolveSymbolAsset(symbol: string, em: typeof DI.em) {
  const canonicalSymbol = symbol.trim().toUpperCase();
  const { resolveOrCreateFinancialAsset } = await import('./financial-asset.service');
  const resolved = await resolveOrCreateFinancialAsset(canonicalSymbol, { skipStockSplitSync: true });
  const attached = await em.findOne(FinancialAsset, { deletedAt: undefined, financialAssetKey: resolved.financialAssetKey });
  if (!attached) throw new NotFoundError('Financial asset not found after external symbol resolution');
  return attached;
}

export default new PortfolioImportAssetMappingService();
