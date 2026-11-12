/**
 * Positions files: what a person holds today, not how they got there.
 *
 * A positions session (`PortfolioImportSession.importType === 'positions'`) maps symbol or ISIN,
 * quantity, average unit cost or total cost, currency and an optional acquisition date. Each row
 * becomes one opening BUY on its acquisition date, or on the as-of day the person picks, at the
 * average unit cost, with `OPENING_POSITION_NOTE` in its notes. It is an ordinary BUY: one FIFO
 * lot (or one addition to the average pool), and a contribution on its date for time- and
 * money-weighted returns, exactly as a recorded buy.
 *
 * An opening buy for an asset the portfolio already trades would double the holding, so such a
 * row is skipped (`EXISTING_TRADES_SKIP_REASON`) until the person includes it. The rule runs
 * whenever a row's asset is (re)assigned: after asset resolution, after an asset-review decision,
 * and when a row is included or skipped again.
 */
import type { EntityManager } from '@mikro-orm/core';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioImportAssetGroup } from '@entity/PortfolioImportAssetGroup';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { type PortfolioImportSession, PortfolioImportSessionStatus, PortfolioImportSessionType } from '@entity/PortfolioImportSession';
import { BadRequestError, ConflictError } from '@utils/errors';

import { type PortfolioColumnMapping, portfolioColumnMappingFields, type PortfolioColumnMappingSuggestion, portfolioColumnMappingSuggestionSchema, portfolioColumnMappingTransformationsSchema, type PortfolioImportFixedValues, portfolioImportFixedValuesSchema } from './portfolio-csv-column-mapping.schema';
import { normalizeCsvHeader } from './portfolio-csv-layout.utils';
import { buildImportSessionSummary, canConfirm, type ImportSessionSummary, recomputeImportSessionStatus } from './portfolio-import-session-state';
import portfolioImportSessionService from './portfolio-import-session.service';

/** The note on every opening buy a positions file creates. */
export const OPENING_POSITION_NOTE = 'Opening position (imported from a positions file)';
/** The skip reason of a positions row whose asset already has trades in the portfolio. */
export const EXISTING_TRADES_SKIP_REASON = 'Asset already has trades in this portfolio';

export function isPositionsSession(session: Pick<PortfolioImportSession, 'importType'>): boolean {
  return session.importType === PortfolioImportSessionType.POSITIONS;
}

/**
 * A positions mapping needs quantity, a cost (average unit cost or total cost), a currency and an
 * asset identity. The acquisition date is optional: without the column, every row is bought on
 * `asOfDate`, which must then be given. Transaction type and its direction rules do not apply.
 */
export function validateConfirmedPositionsColumnMapping(input: { asOfDate?: string; columnMapping: PortfolioColumnMapping; fixedValues?: PortfolioImportFixedValues; transformations: unknown }) {
  const columnMapping = Object.fromEntries(portfolioColumnMappingFields.flatMap((field) => {
    const value = input.columnMapping[field];
    return value && !['externalTransactionId', 'feeAmount', 'transactionType'].includes(field) ? [[field, value]] : [];
  })) as PortfolioColumnMapping;
  const transformations = portfolioColumnMappingTransformationsSchema.parse(input.transformations ?? {});
  const fixedValues = portfolioImportFixedValuesSchema.parse({ ...(input.fixedValues?.currency ? { currency: input.fixedValues.currency } : {}), transactionType: 'BUY' });
  const missing: string[] = [];
  if (!columnMapping.quantity) missing.push('quantity');
  if (!columnMapping.currency && !fixedValues.currency) missing.push('currency');
  if (!columnMapping.unitPrice && !columnMapping.totalAmount) missing.push('unitPriceOrTotalAmount');
  if (!columnMapping.isin && !columnMapping.ticker && !columnMapping.assetName) missing.push('assetIdentity');
  if (!columnMapping.transactionDate && !input.asOfDate) missing.push('asOfDate');
  if (missing.length) throw new BadRequestError(`Missing required mapping fields: ${missing.join(', ')}`);
  return { columnMapping, derivedValues: {}, fixedValues, transformations };
}

/** A local mapping for the usual positions export headers, or undefined when it cannot map the essentials. */
export function buildPositionsHeuristicSuggestion(headers: string[]): PortfolioColumnMappingSuggestion | undefined {
  const mapping: PortfolioColumnMapping = {};
  for (const header of headers) {
    const normalized = normalizeCsvHeader(header);
    const matches = (pattern: RegExp) => pattern.test(normalized);
    if (!mapping.totalAmount && matches(/\b(?:total cost|cost basis|book cost|book value|total invested|invested)\b/)) mapping.totalAmount = header;
    else if (!mapping.unitPrice && matches(/\b(?:average (?:unit )?(?:cost|price)|avg (?:cost|price)|unit cost|cost per (?:share|unit)|average|avg)\b/)) mapping.unitPrice = header;
    else if (!mapping.transactionDate && matches(/\b(?:acquisition date|acquired|purchase date|buy date|opened|date)\b/)) mapping.transactionDate = header;
    else if (!mapping.quantity && matches(/\b(?:qty|quantity|shares?|units|position|holding)\b/)) mapping.quantity = header;
    else if (!mapping.currency && matches(/\b(?:currency|ccy)\b/)) mapping.currency = header;
    else if (!mapping.isin && matches(/\bisin\b/)) mapping.isin = header;
    else if (!mapping.ticker && matches(/\b(?:ticker|symbol)\b/)) mapping.ticker = header;
    else if (!mapping.assetName && matches(/\b(?:name|asset|security|product|instrument|description)\b/)) mapping.assetName = header;
    else if (!mapping.brokerExchange && matches(/\b(?:exchange|market|venue)\b/)) mapping.brokerExchange = header;
  }
  if (!mapping.quantity || (!mapping.unitPrice && !mapping.totalAmount) || (!mapping.isin && !mapping.ticker && !mapping.assetName)) return undefined;
  return portfolioColumnMappingSuggestionSchema.parse({ columnMapping: mapping, confidence: 0.6, detectedBroker: null, fixedValues: { transactionType: 'BUY' }, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: ['local heuristic'] });
}

const RULE_STATUSES: readonly PortfolioImportRowStatus[] = [PortfolioImportRowStatus.READY, PortfolioImportRowStatus.SKIPPED];

function isExistingTradesSkip(row: PortfolioImportRow) {
  return row.status === PortfolioImportRowStatus.SKIPPED && row.skipReason === EXISTING_TRADES_SKIP_REASON;
}

/**
 * Applies the existing-trades rule to a positions session's rows: a ready row whose asset the
 * portfolio already trades is flagged (`normalizedJson.existingTrades`) and skipped, unless the
 * person included it (`normalizedJson.includeWithExistingTrades`). A row skipped for that reason
 * whose asset no longer has trades (its asset changed in review) is ready again; with
 * `assetChanged`, an earlier choice to include the row is forgotten. Mutates the rows; the caller
 * persists them. No-op for a trades session.
 */
export async function applyExistingTradesRule(em: EntityManager, session: Pick<PortfolioImportSession, 'importType' | 'portfolioKey'>, rows: PortfolioImportRow[], options: { assetChanged?: boolean } = {}): Promise<void> {
  if (!isPositionsSession(session)) return;
  // A choice to include a row was about the asset it had then; a new asset asks again.
  if (options.assetChanged) {
    for (const row of rows) {
      if (row.normalizedJson?.['includeWithExistingTrades'] === undefined) continue;
      const { includeWithExistingTrades: _forgotten, ...normalized } = row.normalizedJson;
      row.normalizedJson = normalized;
    }
  }
  const candidates = rows.filter((row) => RULE_STATUSES.includes(row.status) && (row.status === PortfolioImportRowStatus.READY || isExistingTradesSkip(row)));
  const assetKeys = [...new Set(candidates.flatMap((row) => (row.financialAssetKey ? [row.financialAssetKey.financialAssetKey] : [])))];
  const traded = new Set<number>();
  if (assetKeys.length > 0) {
    const trades = await em.find(FinancialTransaction, {
      deletedAt: undefined,
      financialAssetKey: { financialAssetKey: { $in: assetKeys } },
      financialTransactionTypeKey: { financialTransactionTypeKey: { $in: [FINANCIAL_TRANSACTION_TYPES.BUY, FINANCIAL_TRANSACTION_TYPES.SELL] } },
      portfolioKey: session.portfolioKey,
    }, { fields: ['financialAssetKey'], filters: false });
    for (const trade of trades) if (trade.financialAssetKey) traded.add(trade.financialAssetKey.financialAssetKey);
  }
  for (const row of candidates) {
    const assetKey = row.financialAssetKey?.financialAssetKey;
    const hasTrades = assetKey !== undefined && traded.has(assetKey);
    const normalized = { ...(row.normalizedJson ?? {}) };
    if (hasTrades) {
      normalized['existingTrades'] = true;
      const included = normalized['includeWithExistingTrades'] === true;
      row.status = included ? PortfolioImportRowStatus.READY : PortfolioImportRowStatus.SKIPPED;
      row.skipReason = included ? undefined : EXISTING_TRADES_SKIP_REASON;
    } else {
      delete normalized['existingTrades'];
      if (isExistingTradesSkip(row)) {
        row.status = PortfolioImportRowStatus.READY;
        row.skipReason = undefined;
      }
    }
    row.normalizedJson = normalized;
  }
}

/** Puts rows skipped for existing trades back to ready, so asset resolution reassigns their asset. */
export function resetExistingTradesSkips(rows: PortfolioImportRow[]): void {
  for (const row of rows) {
    if (!isExistingTradesSkip(row)) continue;
    row.status = PortfolioImportRowStatus.READY;
    row.skipReason = undefined;
  }
}

/** Rows a positions session holds back (or was told to include) because their asset already has trades. */
export function countExistingTradeRows(rows: PortfolioImportRow[]): { existingTradeRows: number; existingTradeSkippedRows: number } {
  const flagged = rows.filter((row) => row.normalizedJson?.['existingTrades'] === true && RULE_STATUSES.includes(row.status));
  return { existingTradeRows: flagged.length, existingTradeSkippedRows: flagged.filter(isExistingTradesSkip).length };
}

/**
 * The session status after a positions review: as `recomputeImportSessionStatus`, except that a
 * session whose every importable row is held back for existing trades stays open (PARTIAL), so
 * the person can still include them.
 */
export interface UpdatePositionRowInclusionInput {
  appuser: Appuser;
  importSessionId: number;
  rows: { include: boolean; rowId: number }[];
  tenant: { tenantKey: number };
}

export interface UpdatePositionRowInclusionResult {
  importSessionId: number;
  status: PortfolioImportSessionStatus;
  summary: ImportSessionSummary & { canConfirm: boolean; existingTradeRows: number; existingTradeSkippedRows: number };
}

export function positionsSessionStatus(rows: PortfolioImportRow[], groups: PortfolioImportAssetGroup[]): PortfolioImportSessionStatus {
  const status = recomputeImportSessionStatus(rows, groups);
  if (status === PortfolioImportSessionStatus.FAILED && countExistingTradeRows(rows).existingTradeSkippedRows > 0) return PortfolioImportSessionStatus.PARTIAL;
  return status;
}

const REVIEWABLE_STATUSES: readonly PortfolioImportSessionStatus[] = [
  PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW,
  PortfolioImportSessionStatus.PARTIAL,
  PortfolioImportSessionStatus.READY_TO_IMPORT,
];

/** Includes or skips again positions rows whose asset already has trades in the portfolio. */
export async function updatePositionRowInclusion(input: UpdatePositionRowInclusionInput): Promise<UpdatePositionRowInclusionResult> {
  return DI.em.transactional(async (em) => {
    const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant }, { em });
    if (portfolioImportSessionService.isExpired(session)) throw new ConflictError('Import session has expired');
    if (!isPositionsSession(session)) throw new ConflictError('Only a positions import has rows to include');
    if (!REVIEWABLE_STATUSES.includes(session.status)) throw new ConflictError('Import session rows cannot be changed');
    const rowIds = input.rows.map((row) => row.rowId);
    if (new Set(rowIds).size !== rowIds.length) throw new BadRequestError('Duplicate row decision');

    const rows = await em.find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: session }, { populate: ['financialAssetKey'] });
    const rowsById = new Map(rows.map((row) => [row.portfolioImportRowKey, row]));
    for (const decision of input.rows) {
      const row = rowsById.get(decision.rowId);
      if (!row) throw new BadRequestError('Import row not found');
      if (row.normalizedJson?.['existingTrades'] !== true || !RULE_STATUSES.includes(row.status)) throw new BadRequestError('Only a row whose asset already has trades can be included');
      row.normalizedJson = { ...row.normalizedJson, includeWithExistingTrades: decision.include };
    }
    await applyExistingTradesRule(em, session, rows);

    const groups = await em.find(PortfolioImportAssetGroup, { deletedAt: undefined, portfolioImportSessionKey: session });
    session.status = positionsSessionStatus(rows, groups);
    const summary = { ...buildImportSessionSummary(rows, groups), ...countExistingTradeRows(rows) };
    session.summaryJson = { ...(session.summaryJson ?? {}), ...summary, assetGroups: { ...((session.summaryJson?.['assetGroups']) ?? {}), ...summary.assetGroups }, blockingRows: summary.duplicateRows + summary.invalidRows + summary.skippedRows, importableRows: summary.readyRows, status: session.status };
    const confirmable = canConfirm(session);
    session.summaryJson = { ...session.summaryJson, canConfirm: confirmable };
    await em.persist([session, ...rows]).flush();
    return { importSessionId: session.portfolioImportSessionKey, status: session.status, summary: { ...summary, canConfirm: confirmable } };
  });
}
