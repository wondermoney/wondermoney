import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { PortfolioImportAssetCandidate } from '@entity/PortfolioImportAssetCandidate';
import { PortfolioImportAssetGroup, PortfolioImportAssetGroupStatus } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';

import { AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING } from './portfolio-csv-column-mapping-warning';
import { type TerminalKind, toTerminalKind } from './portfolio-import-session-state';
import portfolioImportSessionService from './portfolio-import-session.service';

export interface GetPortfolioImportSessionPreviewInput {
  appuser: Appuser;
  importSessionId: number;
  limit: number;
  tenant: { tenantKey: number };
}

export interface PortfolioImportAssetCandidatePreview {
  confidence?: number;
  currency?: string;
  exchange?: string;
  hasPriceHistory: boolean;
  id: number;
  isin?: string;
  isRecommended?: boolean;
  name?: string;
  provider: string;
  rejectedReason?: string;
  symbol?: string;
}

export interface PortfolioImportAssetGroupPreview {
  candidates?: PortfolioImportAssetCandidatePreview[];
  id: number;
  identity: {
    brokerAssetName?: string;
    brokerExchange?: string;
    brokerTicker?: string;
    currency?: string;
    isin?: string;
  };
  recommendationReason?: string;
  recommendedCandidateId?: number;
  resolutionReason?: string;
  selectedAction?: string;
  selectedFinancialAssetId?: number;
  status: PortfolioImportAssetGroupStatus;
}

export interface PortfolioImportPreviewRow {
  assetGroupId?: number;
  failureReason?: string;
  financialAssetId?: number;
  id: number;
  internalTransactionId?: string;
  normalized?: Record<string, unknown>;
  raw: Record<string, unknown>;
  rowNumber: number;
  skipReason?: string;
  status: PortfolioImportRowStatus;
}

export interface PortfolioImportSessionPreviewResponse {
  assetGroups: PortfolioImportAssetGroupPreview[];
  broker?: { id: number; name: string };
  columnMapping?: { confirmed?: unknown; suggestion?: unknown; warning?: string };
  importSessionId: number;
  limits: { rowsPerBucket: number };
  portfolioId: number;
  rows: {
    duplicate: PortfolioImportPreviewRow[];
    failed: PortfolioImportPreviewRow[];
    invalid: PortfolioImportPreviewRow[];
    needsAssetReview: PortfolioImportPreviewRow[];
    ready: PortfolioImportPreviewRow[];
  };
  status: PortfolioImportSessionStatus;
  summary: {
    assetGroups?: {
      ambiguousGroups: number;
      matchedGroups: number;
      providerErrorGroups: number;
      totalGroups: number;
      unmatchedGroups: number;
    };
    blockingRows: number;
    canConfirm: boolean;
    duplicateRows: number;
    failedRows: number;
    failureReason?: string;
    importableRows: number;
    importedRows: number;
    invalidRows: number;
    needsAssetReviewRows: number;
    readyRows: number;
    skippedRows: number;
    terminalKind?: TerminalKind;
    totalRows: number;
    unsupportedAssets?: { skippedRows: number; symbol: string }[];
  };
}

const MAX_PREVIEW_STRING_LENGTH = 500;
const MAX_PREVIEW_KEY_LENGTH = 120;
const MAX_PREVIEW_ENTRIES = 50;
const COLUMN_MAPPING_KEYS = [
  'transactionDate',
  'transactionType',
  'assetName',
  'isin',
  'ticker',
  'brokerExchange',
  'quantity',
  'unitPrice',
  'totalAmount',
  'currency',
  'feeAmount',
  'externalTransactionId',
] as const;
const TRANSFORMATION_KEYS = [
  'dateFormat',
  'decimalSeparator',
  'thousandsSeparator',
  'negativeAmountMeansBuy',
  'quantitySignIndicatesDirection',
] as const;

const statusOrder: Record<PortfolioImportAssetGroupStatus, number> = {
  [PortfolioImportAssetGroupStatus.AMBIGUOUS]: 0,
  [PortfolioImportAssetGroupStatus.MATCHED]: 3,
  [PortfolioImportAssetGroupStatus.PROVIDER_ERROR]: 2,
  [PortfolioImportAssetGroupStatus.SELECTED]: 4,
  [PortfolioImportAssetGroupStatus.SKIPPED]: 5,
  [PortfolioImportAssetGroupStatus.UNMATCHED]: 1,
};

class PortfolioImportSessionPreviewService {
  async getPreview(input: GetPortfolioImportSessionPreviewInput): Promise<PortfolioImportSessionPreviewResponse> {
    const session = await portfolioImportSessionService.getOwnedSession({
      appuser: input.appuser,
      importSessionId: input.importSessionId,
      tenant: input.tenant,
    });

    const [ready, duplicate, invalid, needsAssetReview, failed] = await Promise.all([
      DI.em.find(
        PortfolioImportRow,
        { deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.READY },
        { limit: input.limit, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] },
      ),
      DI.em.find(
        PortfolioImportRow,
        { deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.DUPLICATE },
        { limit: input.limit, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] },
      ),
      DI.em.find(
        PortfolioImportRow,
        { deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.INVALID },
        { limit: input.limit, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] },
      ),
      DI.em.find(
        PortfolioImportRow,
        {
          deletedAt: undefined,
          portfolioImportSessionKey: session,
          status: PortfolioImportRowStatus.NEEDS_ASSET_REVIEW,
        },
        { limit: input.limit, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] },
      ),
      DI.em.find(
        PortfolioImportRow,
        { deletedAt: undefined, portfolioImportSessionKey: session, status: PortfolioImportRowStatus.FAILED },
        { limit: input.limit, orderBy: { rowNumber: 'asc' }, populate: ['assetGroupKey', 'financialAssetKey'] },
      ),
    ]);

    const groups = await DI.em.find(
      PortfolioImportAssetGroup,
      { deletedAt: undefined, portfolioImportSessionKey: session },
      { orderBy: { portfolioImportAssetGroupKey: 'asc' }, populate: ['selectedFinancialAssetKey'] },
    );
    const candidates = groups.length
      ? await DI.em.find(
          PortfolioImportAssetCandidate,
          { deletedAt: undefined, portfolioImportAssetGroupKey: groups },
          { orderBy: { confidence: 'desc', symbol: 'asc' } },
        )
      : [];

    const candidatesByGroupId = new Map<number, PortfolioImportAssetCandidatePreview[]>();
    for (const candidate of candidates) {
      const groupId = candidate.portfolioImportAssetGroupKey.portfolioImportAssetGroupKey;
      const mapped: PortfolioImportAssetCandidatePreview = {
        confidence: asNumber(candidate.confidence),
        currency: candidate.currency,
        exchange: candidate.exchange,
        hasPriceHistory: candidate.hasPriceHistory,
        id: candidate.portfolioImportAssetCandidateKey,
        isin: candidate.isin,
        name: candidate.name,
        provider: candidate.provider,
        rejectedReason: candidate.rejectedReason,
        symbol: candidate.symbol,
      };
      const list = candidatesByGroupId.get(groupId) ?? [];
      list.push(mapped);
      candidatesByGroupId.set(groupId, list);
    }
    for (const list of candidatesByGroupId.values()) {
      list.sort(
        (a, b) =>
          (b.confidence ?? -Infinity) - (a.confidence ?? -Infinity) ||
          (a.symbol ?? a.name ?? '').localeCompare(b.symbol ?? b.name ?? '') ||
          a.id - b.id,
      );
    }

    const recommendationByGroupId = new Map<number, { candidateId: number; reason: string }>();
    for (const group of groups) {
      const candidatesForGroup = candidatesByGroupId.get(group.portfolioImportAssetGroupKey) ?? [];
      const recommendation = getRecommendedCandidate(group, candidatesForGroup);
      if (recommendation) recommendationByGroupId.set(group.portfolioImportAssetGroupKey, recommendation);
    }

    const mappedGroups = groups
      .map((group) => ({
        candidates: candidatesByGroupId.get(group.portfolioImportAssetGroupKey),
        id: group.portfolioImportAssetGroupKey,
        identity: {
          brokerAssetName: group.brokerAssetName,
          brokerExchange: group.brokerExchange,
          brokerTicker: group.brokerTicker,
          currency: group.currency,
          isin: group.isin,
        },
        resolutionReason: group.resolutionReason,
        selectedAction: group.selectedAction,
        selectedFinancialAssetId: group.selectedFinancialAssetKey?.financialAssetKey,
        ...(recommendationByGroupId.get(group.portfolioImportAssetGroupKey)
          ? {
              recommendationReason: recommendationByGroupId.get(group.portfolioImportAssetGroupKey)?.reason,
              recommendedCandidateId: recommendationByGroupId.get(group.portfolioImportAssetGroupKey)?.candidateId,
            }
          : {}),
        status: group.status,
      }))
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.id - b.id);

    return {
      assetGroups: mappedGroups,
      broker: session.financialBrokerKey
        ? { id: session.financialBrokerKey.financialBrokerKey, name: session.financialBrokerKey.name }
        : undefined,
      columnMapping: mapColumnMapping(session.columnMappingJson),
      importSessionId: session.portfolioImportSessionKey,
      limits: { rowsPerBucket: input.limit },
      portfolioId: session.portfolioKey.portfolioKey,
      rows: {
        duplicate: duplicate.map(mapRow),
        failed: failed.map(mapRow),
        invalid: invalid.map(mapRow),
        needsAssetReview: needsAssetReview.map(mapRow),
        ready: ready.map(mapRow),
      },
      status: session.status,
      summary: mapSummary(session.summaryJson),
    };
  }
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getFailureReason(sessionSummary: Record<string, unknown> | undefined) {
  const explicit = getFailureReasonValue(sessionSummary?.['failureReason']);
  if (explicit) return explicit;
  for (const key of [
    'importWorkerError',
    'parseWorkerError',
    'importMaintenanceError',
    'assetResolutionError',
  ] as const) {
    const reason = getFailureReasonValue(sessionSummary?.[key]);
    if (reason) return reason;
  }
  if (getFailureReasonValue(sessionSummary?.['columnMappingWarning'])) return AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING;
  const parserError = getFailureReasonValue(sessionSummary?.['parserError']);
  const errorCode = getFailureReasonValue(sessionSummary?.['errorCode']);
  if (parserError && errorCode) return sanitizePreviewValue(`${parserError}: ${errorCode}`) as string;
  if (parserError) return parserError;
  if (errorCode) return errorCode;
  return undefined;
}

function getFailureReasonValue(value: unknown): string | undefined {
  if (typeof value === 'string') return normalizeFailureReason(value);
  if (isRecord(value) && typeof value['message'] === 'string') return normalizeFailureReason(value['message']);
  return undefined;
}

function getRecommendedCandidate(
  group: PortfolioImportAssetGroup,
  candidates: PortfolioImportAssetCandidatePreview[],
): undefined | { candidateId: number; reason: string } {
  const groupIsin = normalizeUpper(group.isin);
  const brokerExchange = normalizeUpper(group.brokerExchange);
  if (!groupIsin || !brokerExchange) return undefined;

  const matches = candidates.filter(
    (candidate) => normalizeUpper(candidate.isin) === groupIsin && isVenueMatch(brokerExchange, candidate),
  );
  if (matches.length !== 1) return undefined;

  const [match] = matches;
  if (!match) return undefined;
  match.isRecommended = true;
  for (const candidate of candidates) {
    if (candidate.id !== match.id) candidate.isRecommended = false;
  }
  return { candidateId: match.id, reason: 'isin_and_venue_match' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isVenueMatch(brokerExchange: string, candidate: PortfolioImportAssetCandidatePreview): boolean {
  const venue = normalizeUpper(candidate.exchange) ?? '';
  const symbol = normalizeUpper(candidate.symbol) ?? '';
  const symbolMatches =
    brokerExchange === 'XAMS' || brokerExchange === 'EAM'
      ? symbol.endsWith('.AS')
      : brokerExchange === 'XETA' || brokerExchange === 'XET'
        ? symbol.endsWith('.DE')
        : false;
  return symbolMatches || venueMatches(brokerExchange, venue);
}

function mapColumnMapping(columnMappingJson: Record<string, unknown> | undefined) {
  if (!columnMappingJson) return undefined;
  const sanitizeDetectedBroker = (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if (sourceHasKey(source, 'id')) result['id'] = sanitizePreviewValue(source['id']);
    if (sourceHasKey(source, 'name')) result['name'] = sanitizePreviewValue(source['name']);
    return Object.keys(result).length ? result : undefined;
  };
  const pickMapping = (mapping: unknown) => {
    if (!mapping || typeof mapping !== 'object') return undefined;
    const source = mapping as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    if ('confidence' in source && typeof source['confidence'] === 'number') result['confidence'] = source['confidence'];
    const detectedBroker = sanitizeDetectedBroker(source['detectedBroker']);
    if (detectedBroker) result['detectedBroker'] = detectedBroker;
    const columnMapping = source['columnMapping'];
    if (columnMapping && typeof columnMapping === 'object') {
      const columnResult: Record<string, unknown> = {};
      for (const key of COLUMN_MAPPING_KEYS) {
        if (sourceHasKey(columnMapping, key)) columnResult[key] = sanitizePreviewValue(columnMapping[key]);
      }
      if (Object.keys(columnResult).length) result['columnMapping'] = columnResult;
    }
    const transformations = source['transformations'];
    if (transformations && typeof transformations === 'object') {
      const transformationResult: Record<string, unknown> = {};
      for (const key of TRANSFORMATION_KEYS) {
        if (sourceHasKey(transformations, key)) transformationResult[key] = sanitizePreviewValue(transformations[key]);
      }
      if (Object.keys(transformationResult).length) result['transformations'] = transformationResult;
    }
    const layout = sanitizeLayout(source['layout']);
    if (layout) result['layout'] = layout;
    if (sourceHasKey(source, 'warning') && typeof source['warning'] === 'string') result['warning'] = source['warning'];
    if (sourceHasKey(source, 'confirmedAt')) result['confirmedAt'] = source['confirmedAt'];
    return Object.keys(result).length ? result : undefined;
  };
  const result: { confirmed?: unknown; suggestion?: unknown; warning?: string } = {};
  const suggestion = pickMapping(columnMappingJson['suggestion']);
  const confirmed = pickMapping(columnMappingJson['confirmed']);
  if (suggestion) result.suggestion = suggestion;
  if (confirmed) result.confirmed = confirmed;
  if (typeof columnMappingJson['warning'] === 'string') result.warning = AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING;
  return Object.keys(result).length ? result : undefined;
}

function mapRow(row: PortfolioImportRow): PortfolioImportPreviewRow {
  const normalized = sanitizePreviewValue(row.normalizedJson);
  const raw = sanitizePreviewValue(row.rawJson);
  return {
    assetGroupId: row.assetGroupKey?.portfolioImportAssetGroupKey,
    failureReason: row.failureReason,
    financialAssetId: row.financialAssetKey?.financialAssetKey,
    id: row.portfolioImportRowKey,
    internalTransactionId: row.internalTransactionId,
    normalized: isRecord(normalized) ? normalized : undefined,
    raw: isRecord(raw) ? raw : {},
    rowNumber: row.rowNumber,
    skipReason: row.skipReason,
    status: row.status,
  };
}

function mapSummary(sessionSummary: Record<string, unknown> | undefined) {
  const assetGroups = isRecord(sessionSummary?.['assetGroups']) ? sessionSummary['assetGroups'] : undefined;
  return {
    assetGroups: assetGroups
      ? {
          ambiguousGroups: asNumber(assetGroups['ambiguousGroups']),
          matchedGroups: asNumber(assetGroups['matchedGroups']),
          providerErrorGroups: asNumber(assetGroups['providerErrorGroups']),
          totalGroups: asNumber(assetGroups['totalGroups']),
          unmatchedGroups: asNumber(assetGroups['unmatchedGroups']),
        }
      : undefined,
    blockingRows: asNumber(sessionSummary?.['blockingRows']),
    canConfirm: Boolean(sessionSummary?.['canConfirm']),
    duplicateRows: asNumber(sessionSummary?.['duplicateRows']),
    failedRows: asNumber(sessionSummary?.['failedRows']),
    failureReason: getFailureReason(sessionSummary),
    importableRows: asNumber(sessionSummary?.['importableRows']),
    importedRows: asNumber(sessionSummary?.['importedRows']),
    invalidRows: asNumber(sessionSummary?.['invalidRows']),
    needsAssetReviewRows: asNumber(sessionSummary?.['needsAssetReviewRows']),
    readyRows: asNumber(sessionSummary?.['readyRows']),
    skippedRows: asNumber(sessionSummary?.['skippedRows']),
    terminalKind: toTerminalKind(sessionSummary?.['terminalKind']),
    totalRows: asNumber(sessionSummary?.['totalRows']),
    unsupportedAssets: mapUnsupportedAssets(sessionSummary?.['unsupportedAssets']),
  };
}

function mapUnsupportedAssets(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry['symbol'] !== 'string') return [];
    const symbol = sanitizePreviewValue(entry['symbol']);
    if (typeof symbol !== 'string') return [];
    return [{ skippedRows: asNumber(entry['skippedRows']), symbol }];
  });
}

function normalizeFailureReason(value: string): string | undefined {
  if (/NO_VALUE_PROVIDED_FOR_INPUT_HTTP_LABEL:?_?KEY/i.test(value)) return 'Portfolio import upload key is missing';
  if (
    /select\s+"p\d+"\.|\bSQLSTATE\b|syntax error|column .* does not exist|relation .* does not exist|stack:\s*Error/i.test(
      value,
    )
  )
    return 'Import processing failed';
  const sanitized = sanitizePreviewValue(value);
  return typeof sanitized === 'string' ? sanitized : undefined;
}

function normalizeUpper(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function sanitizeFooterMatcher(value: unknown): string | undefined {
  const sanitized = sanitizePreviewValue(value);
  if (typeof sanitized !== 'string') return undefined;
  const trimmed = sanitized.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeLayout(layout: unknown) {
  if (!layout || typeof layout !== 'object') return undefined;
  const source = layout as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (isSafeInteger(source['headerRowIndex'])) result['headerRowIndex'] = source['headerRowIndex'];
  if (isSafeInteger(source['dataStartRowIndex'])) result['dataStartRowIndex'] = source['dataStartRowIndex'];
  if (isSafeInteger(source['footerRowCount'])) result['footerRowCount'] = source['footerRowCount'];
  if (Array.isArray(source['footerMatchers'])) {
    const footerMatchers = source['footerMatchers']
      .map((item) => sanitizeFooterMatcher(item))
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (footerMatchers.length) result['footerMatchers'] = footerMatchers;
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizePreviewValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return value.length > MAX_PREVIEW_STRING_LENGTH ? `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizePreviewValue(item)).filter((item) => item !== undefined);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_PREVIEW_ENTRIES);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      if (entryValue === undefined) continue;
      const safeKey = key.length > MAX_PREVIEW_KEY_LENGTH ? key.slice(0, MAX_PREVIEW_KEY_LENGTH) : key;
      const sanitized = sanitizePreviewValue(entryValue);
      if (sanitized !== undefined) result[safeKey] = sanitized;
    }
    return result;
  }
  return String(value);
}

function sourceHasKey(source: unknown, key: string): source is Record<string, unknown> {
  return typeof source === 'object' && source !== null && key in source;
}

function venueMatches(brokerExchange: string, candidateExchange: string): boolean {
  const aliases =
    brokerExchange === 'XAMS' || brokerExchange === 'EAM'
      ? ['XAMS', 'EAM', 'EURONEXT AMSTERDAM', 'AMSTERDAM']
      : brokerExchange === 'XETA' || brokerExchange === 'XET'
        ? ['XETA', 'XET', 'XETRA', 'GERMANY']
        : [];
  return aliases.includes(candidateExchange);
}

export default new PortfolioImportSessionPreviewService();
