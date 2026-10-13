import { type EntityManager, LockMode } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';
import { normalizePortfolioTransactionQuantity } from '@wondermoney/shared';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import type { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import portfolioImportParserSpecService from './portfolio-import-parser-spec.service';
import { terminalKind, type TerminalKind } from './portfolio-import-session-state';
import portfolioTransactionService from './portfolio-transaction.service.js';

export interface FinalizePortfolioImportSessionInput { importSessionId: number }
export interface FinalizePortfolioImportSessionResult {
  duplicateRows: number;
  failedRows: number;
  importedRows: number;
  invalidRows: number;
  readyRows: number;
  skippedRows: number;
  status: PortfolioImportSessionStatus;
  terminalKind?: TerminalKind;
  totalRows: number;
}
interface FinalizeDeps {
  createPortfolioTransaction?: (appuser: Appuser, params: {
    assetSymbol: string;
    brokerId?: number;
    externalTransactionId?: string;
    feeAmount?: number;
    feeCurrencyId?: number;
    financialAsset?: FinancialAsset;
    financialTransactionTypeId: number;
    internalTransactionId?: string;
    notes?: string;
    originalCurrencyId?: number;
    originalUnitPrice?: number;
    portfolioId: number;
    quantity: number;
    settlementCurrencyId: number;
    skipMaintenance?: boolean;
    tenantId?: number;
    transactionDate: Date;
    unitPrice: number;
  }, entityManager?: EntityManager) => Promise<void>;
  promoteParserSpec?: (input: { expectedBrokerKey: number; expectedContentHash: string; expectedTenantKey: number; parserSpecKey: number }, em: EntityManager) => Promise<{ globalParserSpecKey?: number; status: 'conflict' | 'ineligible' | 'promoted' }>;
  recordAppliedSpecSuccess?: (input: { contentHash: string; parserSpecKey: number }, em: EntityManager) => Promise<void>;
  triggerMaintenance?: (input: { earliestTransactionDate?: Date; portfolioId: number }) => Promise<void>;
}

class PortfolioImportFinalizeService {
  async finalizeImportSession(input: FinalizePortfolioImportSessionInput, deps: FinalizeDeps = {}): Promise<FinalizePortfolioImportSessionResult> {
    return DI.em.transactional(async (em) => {
      const session = await em.findOne(PortfolioImportSession, { deletedAt: undefined, portfolioImportSessionKey: input.importSessionId }, { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['appuserKey.currencyKey', 'portfolioKey', 'tenantKey', 'financialBrokerKey'] });
      if (!session) throw new NotFoundError('Import session not found');
      if (session.status !== PortfolioImportSessionStatus.IMPORTING) throw new ConflictError('Import session cannot be finalized');

      const rows = (await em.find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: session }, { orderBy: { rowNumber: 'asc' }, populate: ['financialAssetKey', 'importedFinancialTransactionKey'] })).sort((a, b) => compareRowsByDateThenRowNumber(a, b));

      const create = deps.createPortfolioTransaction ?? ((appuser, params, entityManager) => portfolioTransactionService.createPortfolioTransaction(appuser, params, entityManager));
      let newlyImportedRows = 0;
      let earliestNewlyImportedDate: Date | undefined;
      const recoveredImportErrors: string[] = [];

      for (const row of rows) {
      if (row.status === PortfolioImportRowStatus.IMPORTED) {
        continue;
      }
      if (row.status !== PortfolioImportRowStatus.READY) {
        continue;
      }

      try {
        if (!row.financialAssetKey) throw new Error('Missing financial asset');
        if (!row.internalTransactionId) throw new Error('Missing internalTransactionId');

        const normalized = row.normalizedJson ?? {};
        const transactionDate = toDate(normalized['date']);
        const transactionType = typeof normalized['transactionType'] === 'string' ? normalized['transactionType'] : undefined;
        const transactionTypeId = normalized['transactionTypeId'];
        const quantity = normalized['quantity'];
        const unitPrice = normalized['unitPrice'];
        const settlementCurrencyCode = typeof normalized['settlementCurrencyCode'] === 'string' ? normalized['settlementCurrencyCode'] : undefined;
        const settlementCurrencyId = normalized['settlementCurrencyId'];
        const externalTransactionId = normalized['externalTransactionId'];
        const notes = normalized['notes'];
        const feeAmount = normalized['feeAmount'];
        const feeCurrencyId = normalized['feeCurrencyId'];
        const originalCurrencyId = normalized['originalCurrencyId'];
        const originalUnitPrice = normalized['originalUnitPrice'];

        if (!transactionDate) throw new Error('Invalid date');
        if (!transactionType && typeof transactionTypeId !== 'number') throw new Error('Invalid transaction type');
        if (transactionType && transactionType !== 'BUY' && transactionType !== 'SELL') throw new Error('Invalid transaction type');
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid quantity');
        if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Invalid unitPrice');
        if (settlementCurrencyCode === undefined && typeof settlementCurrencyId !== 'number') throw new Error('Invalid settlementCurrency');

        const type = typeof transactionTypeId === 'number'
          ? await em.findOne(FinancialTransactionType, { financialTransactionTypeKey: transactionTypeId })
          : await em.findOne(FinancialTransactionType, { name: transactionType });
        if (!type) throw new Error(`Financial transaction type not found: ${transactionType ?? transactionTypeId}`);
        if (type.name !== 'BUY' && type.name !== 'SELL') throw new Error('Invalid transaction type');
        const currency = typeof settlementCurrencyId === 'number'
          ? await em.findOne(Currency, { currencyKey: settlementCurrencyId })
          : await em.findOne(Currency, { code: settlementCurrencyCode });
        if (!currency) throw new Error(`Currency not found: ${settlementCurrencyCode ?? settlementCurrencyId}`);

        const existing = await em.findOne(FinancialTransaction, { internalTransactionId: row.internalTransactionId }, { populate: ['portfolioKey', 'financialAssetKey', 'financialTransactionTypeKey', 'settlementCurrencyKey'] });
        if (existing) {
          if (matchesImportedTransaction(existing, session, row, transactionDate, type, currency, externalTransactionId, feeAmount, feeCurrencyId, originalCurrencyId, originalUnitPrice, quantity, unitPrice)) {
            row.status = PortfolioImportRowStatus.IMPORTED;
            row.importedFinancialTransactionKey = existing;
            row.failureReason = undefined;
            row.skipReason = undefined;
            newlyImportedRows += 1;
            if (!earliestNewlyImportedDate || createdDate(existing) < earliestNewlyImportedDate) earliestNewlyImportedDate = createdDate(existing);
          } else {
            row.status = PortfolioImportRowStatus.DUPLICATE;
            row.importedFinancialTransactionKey = existing;
            row.failureReason = undefined;
            row.skipReason = 'Duplicate internalTransactionId';
          }
          continue;
        }

        await create(session.appuserKey, {
          assetSymbol: row.financialAssetKey.symbol,
          brokerId: session.financialBrokerKey?.financialBrokerKey,
          externalTransactionId: typeof externalTransactionId === 'string' ? externalTransactionId : undefined,
          feeAmount: typeof feeAmount === 'number' && Number.isFinite(feeAmount) ? feeAmount : undefined,
          feeCurrencyId: typeof feeAmount === 'number' && Number.isFinite(feeAmount)
            ? (typeof feeCurrencyId === 'number' && Number.isFinite(feeCurrencyId) ? feeCurrencyId : currency.currencyKey)
            : undefined,
          financialAsset: row.financialAssetKey,
          financialTransactionTypeId: type.financialTransactionTypeKey,
          internalTransactionId: row.internalTransactionId,
          notes: typeof notes === 'string' ? notes : undefined,
          originalCurrencyId: typeof originalCurrencyId === 'number' && Number.isFinite(originalCurrencyId) ? originalCurrencyId : undefined,
          originalUnitPrice: typeof originalUnitPrice === 'number' && Number.isFinite(originalUnitPrice) ? originalUnitPrice : undefined,
          portfolioId: session.portfolioKey.portfolioKey,
          quantity,
          settlementCurrencyId: currency.currencyKey,
          skipMaintenance: true,
          tenantId: session.tenantKey.tenantKey,
          transactionDate,
          unitPrice,
        }, em);

        const created = await em.findOne(FinancialTransaction, { internalTransactionId: row.internalTransactionId });
        if (!created) throw new Error('Created financial transaction not found');

        row.status = PortfolioImportRowStatus.IMPORTED;
        row.importedFinancialTransactionKey = created;
        row.failureReason = undefined;
        row.skipReason = undefined;
        newlyImportedRows += 1;
        if (!earliestNewlyImportedDate || created.transactionDate && created.transactionDate < earliestNewlyImportedDate) earliestNewlyImportedDate = created.transactionDate;
      } catch (error) {
        const created = row.internalTransactionId
          ? await em.findOne(FinancialTransaction, { internalTransactionId: row.internalTransactionId }, { populate: ['portfolioKey', 'financialAssetKey', 'financialTransactionTypeKey', 'settlementCurrencyKey'] })
          : null;
        if (created) {
          row.status = PortfolioImportRowStatus.IMPORTED;
          row.importedFinancialTransactionKey = created;
          row.failureReason = undefined;
          row.skipReason = undefined;
          newlyImportedRows += 1;
          recoveredImportErrors.push(error instanceof Error ? error.message : 'Post-insert import maintenance failed');
          if (!earliestNewlyImportedDate || created.transactionDate && created.transactionDate < earliestNewlyImportedDate) earliestNewlyImportedDate = created.transactionDate;
        } else {
          row.status = PortfolioImportRowStatus.FAILED;
          row.failureReason = error instanceof Error ? error.message : 'Import failed';
        }
      }
    }

      const summary = summarizeRows(rows);
      const rowFailureReason = getFirstRowFailureReason(rows);
      const remainingBlocking = summary.failedRows + summary.duplicateRows + summary.invalidRows + summary.skippedRows + summary.readyRows;
      const nextStatus = summary.importedRows > 0 && remainingBlocking === 0 ? PortfolioImportSessionStatus.SUCCEEDED : summary.importedRows > 0 ? PortfolioImportSessionStatus.PARTIAL : PortfolioImportSessionStatus.FAILED;
      // `duplicate_only` carries information the status alone loses, so it is kept
      // as an explicit case; every other terminal kind comes from the shared mapper.
      const sessionTerminalKind: TerminalKind = summary.importedRows === 0 && summary.duplicateRows > 0 && remainingBlocking === summary.duplicateRows ? 'duplicate_only' : terminalKind(nextStatus);
      session.status = nextStatus;
      const preservedSummary = session.summaryJson ?? {};
      session.summaryJson = { ...preservedSummary, ...summary, ...(rowFailureReason ? { failureReason: rowFailureReason } : {}), ...(recoveredImportErrors.length > 0 ? { importMaintenanceError: recoveredImportErrors.join('; ') } : {}), status: nextStatus, terminalKind: sessionTerminalKind };

      if (rowFailureReason || summary.failedRows > 0) logger.error({ failedRows: summary.failedRows, failureReason: rowFailureReason, importedRows: summary.importedRows, importSessionId: input.importSessionId, status: nextStatus }, 'Portfolio CSV import finalized with failed rows');
      await em.persist([session, ...rows]).flush();
      const parserSpecKey = session.columnMappingJson?.['candidateParserSpecKey'];
      const candidateContentHash = session.columnMappingJson?.['candidateParserSpecContentHash'];
      const successfulImport = summary.importedRows > 0 && summary.failedRows === 0 && summary.invalidRows === 0;
      if (successfulImport && typeof parserSpecKey === 'number' && typeof candidateContentHash === 'string' && session.financialBrokerKey) {
        const brokerKey = session.financialBrokerKey.financialBrokerKey;
        const promote = deps.promoteParserSpec ?? ((promotionInput, nestedEm) => portfolioImportParserSpecService.promoteTenantSpec(promotionInput, nestedEm));
        const previousPromotion = session.columnMappingJson?.['parserSpecPromotion'];
        const attemptCount = isRecord(previousPromotion) && typeof previousPromotion['attemptCount'] === 'number' ? previousPromotion['attemptCount'] + 1 : 1;
        const lastAttemptAt = new Date().toISOString();
        session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: { attemptCount, candidateParserSpecKey: parserSpecKey, lastAttemptAt, status: 'pending' } };
        await em.persist(session).flush();
        try {
          const promotion = await em.transactional((nestedEm) => promote({ expectedBrokerKey: brokerKey, expectedContentHash: candidateContentHash, expectedTenantKey: session.tenantKey.tenantKey, parserSpecKey }, nestedEm));
          session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: { attemptCount, candidateParserSpecKey: parserSpecKey, ...(promotion.globalParserSpecKey === undefined ? {} : { globalParserSpecKey: promotion.globalParserSpecKey }), lastAttemptAt, status: promotion.status } };
          await em.persist(session).flush();
        } catch (error) {
          logger.warn({ brokerId: session.financialBrokerKey.financialBrokerKey, error, importSessionId: input.importSessionId, parserSpecKey }, 'Portfolio import parser spec promotion failed');
          Sentry.captureException(error, { extra: { brokerId: session.financialBrokerKey.financialBrokerKey, importSessionId: input.importSessionId, parserSpecKey }, level: 'warning', tags: { stage: 'portfolio-import-parser-spec-promotion' } });
          session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: { attemptCount, candidateParserSpecKey: parserSpecKey, lastAttemptAt, status: 'failed' } };
          await em.persist(session).flush();
        }
      }
      const appliedParserSpecKey = session.columnMappingJson?.['appliedParserSpecKey'];
      const appliedParserSpecContentHash = session.columnMappingJson?.['appliedParserSpecContentHash'];
      if (successfulImport && typeof appliedParserSpecKey === 'number' && typeof appliedParserSpecContentHash === 'string' && appliedParserSpecContentHash === candidateContentHash) {
        const recordSuccess = deps.recordAppliedSpecSuccess ?? ((feedbackInput, feedbackEm) => portfolioImportParserSpecService.recordSpecSuccessByKey(feedbackInput, feedbackEm));
        const previousFeedback = session.columnMappingJson?.['appliedSpecFeedback'];
        const attemptCount = isRecord(previousFeedback) && typeof previousFeedback['attemptCount'] === 'number' ? previousFeedback['attemptCount'] + 1 : 1;
        const lastAttemptAt = new Date().toISOString();
        session.columnMappingJson = { ...(session.columnMappingJson ?? {}), appliedSpecFeedback: { attemptCount, lastAttemptAt, status: 'pending' } };
        await em.persist(session).flush();
        try {
          await em.transactional((nestedEm) => recordSuccess({ contentHash: appliedParserSpecContentHash, parserSpecKey: appliedParserSpecKey }, nestedEm));
          session.columnMappingJson = { ...(session.columnMappingJson ?? {}), appliedSpecFeedback: { attemptCount, lastAttemptAt, status: 'succeeded' } };
          await em.persist(session).flush();
        } catch (error) {
          logger.warn({ error, importSessionId: input.importSessionId, parserSpecKey: appliedParserSpecKey }, 'Portfolio import parser spec success feedback failed');
          session.columnMappingJson = { ...(session.columnMappingJson ?? {}), appliedSpecFeedback: { attemptCount, lastAttemptAt, status: 'failed' } };
          await em.persist(session).flush();
        }
      }
      if (newlyImportedRows > 0 && deps.triggerMaintenance) {
        try { await deps.triggerMaintenance({ earliestTransactionDate: earliestNewlyImportedDate, portfolioId: session.portfolioKey.portfolioKey }); } catch (error) { session.summaryJson = { ...(session.summaryJson ?? {}), importMaintenanceError: error instanceof Error ? error.message : 'Maintenance trigger failed' }; await em.persist(session).flush(); }
      }
      return { ...summary, status: session.status, terminalKind: sessionTerminalKind };
    }, { clear: true });
  }

  async retryParserSpecPromotion(input: { importSessionId: number }, deps: Pick<FinalizeDeps, 'promoteParserSpec'> = {}) {
    return DI.em.transactional(async (em) => {
      const session = await em.findOne(PortfolioImportSession, { deletedAt: undefined, portfolioImportSessionKey: input.importSessionId }, { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['financialBrokerKey', 'tenantKey'] });
      if (!session) throw new NotFoundError('Import session not found');
      const previousPromotion = session.columnMappingJson?.['parserSpecPromotion'];
      if (!isRecord(previousPromotion) || typeof previousPromotion['status'] !== 'string') throw new ConflictError('Import session parser spec promotion metadata is incomplete');
      if (['awaiting_finalization', 'conflict', 'ineligible', 'promoted'].includes(previousPromotion['status'])) return previousPromotion;
      if (![PortfolioImportSessionStatus.PARTIAL, PortfolioImportSessionStatus.SUCCEEDED].includes(session.status) || !hasPromotionTerminalEvidence(session.summaryJson)) throw new ConflictError('Import session parser spec promotion cannot be retried before successful finalization');
      if (previousPromotion['status'] !== 'failed' && !(previousPromotion['status'] === 'pending' && isStalePromotionMarker(previousPromotion))) return previousPromotion;
      const parserSpecKey = session.columnMappingJson?.['candidateParserSpecKey'];
      const contentHash = session.columnMappingJson?.['candidateParserSpecContentHash'];
      if (typeof parserSpecKey !== 'number' || typeof contentHash !== 'string' || !session.financialBrokerKey) throw new ConflictError('Import session parser spec promotion metadata is incomplete');
      const brokerKey = session.financialBrokerKey.financialBrokerKey;
      const attemptCount = isRecord(previousPromotion) && typeof previousPromotion['attemptCount'] === 'number' ? previousPromotion['attemptCount'] + 1 : 1;
      const lastAttemptAt = new Date().toISOString();
      session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: { attemptCount, candidateParserSpecKey: parserSpecKey, lastAttemptAt, status: 'pending' } };
      await em.persist(session).flush();
      const promote = deps.promoteParserSpec ?? ((promotionInput, nestedEm) => portfolioImportParserSpecService.promoteTenantSpec(promotionInput, nestedEm));
      try {
        const promotion = await em.transactional((nestedEm) => promote({ expectedBrokerKey: brokerKey, expectedContentHash: contentHash, expectedTenantKey: session.tenantKey.tenantKey, parserSpecKey }, nestedEm));
        const marker = { attemptCount, candidateParserSpecKey: parserSpecKey, ...(promotion.globalParserSpecKey === undefined ? {} : { globalParserSpecKey: promotion.globalParserSpecKey }), lastAttemptAt, status: promotion.status };
        session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: marker };
        await em.persist(session).flush();
        return marker;
      } catch (error) {
        const marker = { attemptCount, candidateParserSpecKey: parserSpecKey, lastAttemptAt, status: 'failed' as const };
        logger.warn({ brokerId: session.financialBrokerKey.financialBrokerKey, error, importSessionId: input.importSessionId, parserSpecKey }, 'Portfolio import parser spec promotion retry failed');
        session.columnMappingJson = { ...(session.columnMappingJson ?? {}), parserSpecPromotion: marker };
        await em.persist(session).flush();
        return marker;
      }
    });
  }
}

function compareRowsByDateThenRowNumber(a: PortfolioImportRow, b: PortfolioImportRow) {
  const aTime = toDate(a.normalizedJson?.['date'])?.getTime() ?? 0;
  const bTime = toDate(b.normalizedJson?.['date'])?.getTime() ?? 0;
  const dateDiff = aTime - bTime;
  if (dateDiff !== 0) return dateDiff;
  return a.rowNumber - b.rowNumber;
}

function createdDate(transaction: FinancialTransaction) {
  return transaction.transactionDate ?? new Date(0);
}

function getFirstRowFailureReason(rows: PortfolioImportRow[]): string | undefined {
  const failedRow = rows.find((row) => [PortfolioImportRowStatus.FAILED, PortfolioImportRowStatus.INVALID].includes(row.status) && row.failureReason?.trim());
  return failedRow?.failureReason?.trim();
}

function hasPromotionTerminalEvidence(summary: Record<string, unknown> | undefined) {
  return typeof summary?.['importedRows'] === 'number' && summary['importedRows'] > 0
    && summary['failedRows'] === 0
    && summary['invalidRows'] === 0
    && (summary['terminalKind'] === 'success' || summary['terminalKind'] === 'partial_success');
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function isStalePromotionMarker(marker: Record<string, unknown>) {
  if (typeof marker['lastAttemptAt'] !== 'string') return true;
  const timestamp = Date.parse(marker['lastAttemptAt']);
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= 15 * 60 * 1000;
}

function matchesImportedTransaction(existing: FinancialTransaction, session: PortfolioImportSession, row: PortfolioImportRow, transactionDate: Date, type: FinancialTransactionType, currency: Currency, externalTransactionId: unknown, feeAmount: unknown, feeCurrencyId: unknown, originalCurrencyId: unknown, originalUnitPrice: unknown, quantity: unknown, unitPrice: unknown) {
  return existing.portfolioKey?.portfolioKey === session.portfolioKey.portfolioKey
    && existing.financialAssetKey?.financialAssetKey === row.financialAssetKey?.financialAssetKey
    && existing.financialTransactionTypeKey?.financialTransactionTypeKey === type.financialTransactionTypeKey
    && existing.settlementCurrencyKey.currencyKey === currency.currencyKey
    && existing.transactionDate?.toISOString() === transactionDate.toISOString()
    && existing.quantity === (typeof quantity === 'number' ? normalizePortfolioTransactionQuantity(type.name, quantity) : quantity)
    && existing.externalTransactionId === (typeof externalTransactionId === 'string' ? externalTransactionId : undefined)
    && existing.feeAmount === (typeof feeAmount === 'number' ? feeAmount : undefined)
    && existing.feeCurrencyKey?.currencyKey === (typeof feeAmount === 'number' ? (typeof feeCurrencyId === 'number' ? feeCurrencyId : currency.currencyKey) : undefined)
    && existing.originalCurrencyKey?.currencyKey === (typeof originalCurrencyId === 'number' ? originalCurrencyId : undefined)
    && existing.originalUnitAmount === (typeof originalUnitPrice === 'number' ? originalUnitPrice : undefined)
    && existing.settlementUnitAmount === (typeof unitPrice === 'number' ? unitPrice : undefined);
}

function summarizeRows(rows: PortfolioImportRow[]) {
  const duplicateRows = rows.filter((row) => row.status === PortfolioImportRowStatus.DUPLICATE).length;
  const failedRows = rows.filter((row) => row.status === PortfolioImportRowStatus.FAILED).length;
  const importedRows = rows.filter((row) => row.status === PortfolioImportRowStatus.IMPORTED).length;
  const invalidRows = rows.filter((row) => row.status === PortfolioImportRowStatus.INVALID).length;
  const readyRows = rows.filter((row) => row.status === PortfolioImportRowStatus.READY).length;
  const skippedRows = rows.filter((row) => row.status === PortfolioImportRowStatus.SKIPPED).length;
  return {
    blockingRows: duplicateRows + failedRows + invalidRows + skippedRows,
    duplicateRows,
    failedRows,
    importableRows: readyRows,
    importedRows,
    invalidRows,
    readyRows,
    skippedRows,
    totalRows: rows.length,
  };
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value !== 'string') return undefined;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) {
    const [_, year, month, day] = isoDate;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.toISOString().slice(0, 10) === value ? date : undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ymd = parsed.toISOString().slice(0, 10);
    const inputYmd = value.slice(0, 10);
    if (ymd !== inputYmd) return undefined;
  }
  return parsed;
}

export default new PortfolioImportFinalizeService();
