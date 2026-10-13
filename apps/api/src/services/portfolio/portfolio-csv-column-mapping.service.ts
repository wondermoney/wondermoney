import * as Sentry from '@sentry/node';
import { csv } from '@wondermoney/shared';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { getLimitedCsvObjectBuffer } from '@service/account/csv-upload-boundary.service';
import { getLimitedCsvObjectText, parseCsvRows } from '@service/account/csv-upload-boundary.service';
import { BadRequestError, ConflictError } from '@utils/errors';
import logger from '@utils/logger';

import { requestPortfolioColumnMappingSuggestion, sanitizePortfolioColumnMappingPromptInput } from './portfolio-csv-column-mapping-openai';
import { AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING } from './portfolio-csv-column-mapping-warning';
import { type PortfolioColumnMapping, portfolioColumnMappingFields, type PortfolioColumnMappingSuggestion, portfolioColumnMappingSuggestionSchema, type PortfolioColumnMappingTransformations, type PortfolioCsvLayout, type PortfolioImportDerivedValues, type PortfolioImportFixedValues, validateConfirmedPortfolioColumnMapping } from './portfolio-csv-column-mapping.schema';
import { generatePortfolioImportInternalTransactionId, parseMappedNumber } from './portfolio-csv-column-mapping.utils';
import { applyPortfolioCsvLayout, normalizeCsvHeader, parseRawCsvRowsForLayout } from './portfolio-csv-layout.utils';
import type { PortfolioImportAssetResolutionResult } from './portfolio-import-asset-resolution.service';
import portfolioImportParserSpecService, { buildPortfolioImportParserSpecPayload, hashPortfolioImportParserSpecPayload, parsePortfolioImportParserSpecPayload, resolveSpecColumnMapping } from './portfolio-import-parser-spec.service';
import { canConfirm, recomputeImportSessionStatus } from './portfolio-import-session-state';
import portfolioImportSessionService from './portfolio-import-session.service';

export interface ConfirmPortfolioColumnMappingDeps {
  getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>;
  getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>;
  getObjectText?: (bucket: string, key: string) => Promise<string>;
  parseCsvRows?: typeof parseCsvRows;
  resolveImportSessionAssets?: (input: { importSessionId: number }) => Promise<PortfolioImportAssetResolutionResult>;
}

export interface ConfirmPortfolioColumnMappingInput {
  appuser: Appuser;
  columnMapping: PortfolioColumnMapping;
  derivedValues?: PortfolioImportDerivedValues;
  fixedValues?: PortfolioImportFixedValues;
  importSessionId: number;
  layout: PortfolioCsvLayout;
  tenant: { tenantKey: number };
  transformations: PortfolioColumnMappingTransformations;
}

export interface SuggestPortfolioColumnMappingInput {
  appuser: Appuser;
  importSessionId: number;
  tenant: { tenantKey: number };
}

export interface SuggestPortfolioColumnMappingResult {
  columnMapping?: PortfolioColumnMappingSuggestion;
  importSessionId: number;
  mappingSource?: 'disabled' | 'llm' | 'local_heuristic' | 'saved_spec';
  status: PortfolioImportSessionStatus;
  warning?: string;
}

class PortfolioCsvColumnMappingService {
  async confirmColumnMapping(input: ConfirmPortfolioColumnMappingInput, deps: ConfirmPortfolioColumnMappingDeps = {}) {
    const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant });
    if (session.status !== PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING) throw new ConflictError('Import session does not need column mapping');

    const confirmed = validateConfirmedPortfolioColumnMapping({ columnMapping: input.columnMapping, derivedValues: input.derivedValues, fixedValues: input.fixedValues, transformations: input.transformations });
    let parsed: { rawRows?: string[][]; rows: Record<string, string>[] };
    try {
      parsed = await parseColumnMappingRows({ bucket: session.s3Bucket, key: session.s3Key, layout: input.layout }, deps);
    } catch {
      throw new BadRequestError('Invalid CSV layout');
    }
    const { rawRows, rows } = parsed;
    const suggestionSource = session.columnMappingJson?.['source'] === 'llm' || session.columnMappingJson?.['source'] === 'spec' ? session.columnMappingJson['source'] : 'user';
    const effectiveTransformations = this.resolveDateFormatForRows(rows, confirmed.columnMapping, confirmed.transformations);

    const previousRows = await DI.em.find(PortfolioImportRow, { deletedAt: undefined, portfolioImportSessionKey: session });
    for (const row of previousRows) row.deletedAt = new Date();

    const persistedRows: PortfolioImportRow[] = [];
    const invalidRowSummaries: { failureReason: string; rowNumber: number }[] = [];
    const seenInternalTransactionIds = new Set<string>();
    let readyRows = 0; let duplicateRows = 0; let invalidRows = 0;
    const context = { brokerId: session.financialBrokerKey?.financialBrokerKey, portfolioId: session.portfolioKey.portfolioKey, tenantId: session.tenantKey.tenantKey };
    for (const [index, rawRow] of rows.entries()) {
      const rowNumber = index + 1;
      const normalizedJson = { ...rawRow } as Record<string, unknown>;
      try {
        const normalized = this.normalizeConfirmedRow(rawRow, confirmed.columnMapping, effectiveTransformations, context, confirmed.fixedValues, confirmed.derivedValues);
        const internalTransactionId = normalized['internalTransactionId'] as string;
        if (seenInternalTransactionIds.has(internalTransactionId)) {
          duplicateRows++;
          persistedRows.push(Object.assign(new PortfolioImportRow(), { internalTransactionId, normalizedJson: normalized, portfolioImportSessionKey: session, rawJson: rawRow, rowNumber, skipReason: 'Duplicate internalTransactionId', status: PortfolioImportRowStatus.DUPLICATE }));
          continue;
        }
        seenInternalTransactionIds.add(internalTransactionId);
        const existing = await DI.em.findOne(FinancialTransaction, { deletedAt: undefined, internalTransactionId });
        const row = Object.assign(new PortfolioImportRow(), { internalTransactionId, normalizedJson: normalized, portfolioImportSessionKey: session, rawJson: rawRow, rowNumber });
        if (existing) { row.status = PortfolioImportRowStatus.DUPLICATE; row.skipReason = 'Duplicate internalTransactionId'; duplicateRows++; } else { row.status = PortfolioImportRowStatus.READY; readyRows++; }
        persistedRows.push(row);
      } catch (error) {
        invalidRows++;
        invalidRowSummaries.push({ failureReason: error instanceof Error ? error.message : 'Unknown error', rowNumber });
        persistedRows.push(Object.assign(new PortfolioImportRow(), { failureReason: error instanceof Error ? error.message : 'Unknown error', normalizedJson, portfolioImportSessionKey: session, rawJson: rawRow, rowNumber, status: PortfolioImportRowStatus.INVALID }));
      }
    }

    if (invalidRows > 0) {
      const invalidRowSummary = summarizeInvalidRows(invalidRowSummaries);
      logger.warn({ dateFormat: confirmed.transformations.dateFormat, importSessionId: session.portfolioImportSessionKey, invalidRows, invalidRowSummary, totalRows: rows.length }, 'Portfolio CSV import produced invalid rows');
      Sentry.captureMessage('Portfolio CSV import produced invalid rows', { extra: { dateFormat: confirmed.transformations.dateFormat, importSessionId: session.portfolioImportSessionKey, invalidRows, invalidRowSummary, totalRows: rows.length }, level: 'warning' });
    }

    const appliedParserSpecKey = session.columnMappingJson?.['parserSpecKey'];
    const appliedParserSpecContentHash = session.columnMappingJson?.['parserSpecContentHash'];
    session.columnMappingJson = { ...(typeof appliedParserSpecKey === 'number' ? { appliedParserSpecKey } : {}), ...(typeof appliedParserSpecContentHash === 'string' ? { appliedParserSpecContentHash } : {}), confirmed: { columnMapping: confirmed.columnMapping, confirmedAt: new Date().toISOString(), derivedValues: confirmed.derivedValues, fixedValues: confirmed.fixedValues, layout: input.layout, transformations: effectiveTransformations }, source: 'user', suggestion: (session.columnMappingJson)?.['suggestion'], version: 1 };
    const userSkippedRows = 0;
    const blockingRows = duplicateRows + invalidRows;
    // Consolidated: canonical status derivation + transitions confirm rule live in
    // portfolio-import-session-state. This module has no asset groups yet.
    const status = recomputeImportSessionStatus(persistedRows, []);
    session.status = status;
    session.summaryJson = { ...(session.summaryJson ?? {}), blockingRows, canConfirm: false, duplicateRows, importableRows: readyRows, invalidRows, readyRows, skippedRows: userSkippedRows, status, totalRows: rows.length, userSkippedRows };
    // Compute after the summary is in place so the predicate can read row counts.
    const confirmable = canConfirm(session);
    session.summaryJson = { ...session.summaryJson, canConfirm: confirmable };
    await DI.em.persist([session, ...previousRows, ...persistedRows]).flush();
    const resolveImportSessionAssets = deps.resolveImportSessionAssets ?? defaultResolveImportSessionAssets;
    if (readyRows > 0) {
      try {
        const resolution = await resolveImportSessionAssets({ importSessionId: session.portfolioImportSessionKey });
        session.status = resolution.status === PortfolioImportSessionStatus.READY_TO_IMPORT && (duplicateRows > 0 || invalidRows > 0) ? PortfolioImportSessionStatus.PARTIAL : resolution.status;
        session.summaryJson = { ...(session.summaryJson ?? {}), status: session.status };
        await DI.em.persist(session).flush();
        await this.saveConfirmedParserSpecIfPossible({ appuser: input.appuser, confirmed: { ...confirmed, transformations: effectiveTransformations }, confirmedInput: input, invalidRows, rawRows, readyRows, rows, session, suggestionSource });
        return resolveConfirmColumnMappingResult(session, { blockingRows, canConfirm: confirmable, duplicateRows, invalidRows, readyRows, skippedRows: userSkippedRows, totalRows: rows.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        session.status = PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW;
        session.summaryJson = { ...(session.summaryJson ?? {}), assetResolutionError: { code: 'ASSET_RESOLUTION_FAILED', message }, blockingRows, canConfirm: confirmable, duplicateRows, importableRows: readyRows, invalidRows, readyRows, skippedRows: userSkippedRows, status: session.status, totalRows: rows.length, userSkippedRows };
        await DI.em.persist(session).flush();
        await this.saveConfirmedParserSpecIfPossible({ appuser: input.appuser, confirmed: { ...confirmed, transformations: effectiveTransformations }, confirmedInput: input, invalidRows, rawRows, readyRows, rows, session, suggestionSource });
        return resolveConfirmColumnMappingResult(session, { blockingRows, canConfirm: confirmable, duplicateRows, invalidRows, readyRows, skippedRows: userSkippedRows, totalRows: rows.length });
      }
    }
    if (invalidRows > 0) await this.saveConfirmedParserSpecIfPossible({ appuser: input.appuser, confirmed: { ...confirmed, transformations: effectiveTransformations }, confirmedInput: input, invalidRows, rawRows, readyRows, rows, session, suggestionSource });
    return resolveConfirmColumnMappingResult(session, { blockingRows, canConfirm: confirmable, duplicateRows, invalidRows, readyRows, skippedRows: userSkippedRows, totalRows: rows.length });
  }

  async suggestColumnMapping(input: SuggestPortfolioColumnMappingInput, deps: { getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>; getObjectText?: (bucket: string, key: string) => Promise<string>; parseCsvRows?: typeof parseCsvRows } = {}): Promise<SuggestPortfolioColumnMappingResult> {
    const session = await portfolioImportSessionService.getOwnedSession({ appuser: input.appuser, importSessionId: input.importSessionId, tenant: input.tenant });
    if (portfolioImportSessionService.isExpired(session)) throw new ConflictError('Import session has expired');
    if (session.status !== PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING) throw new ConflictError('Import session does not need column mapping');

    const { rawRows, rows } = await parseColumnMappingSuggestionRows({ bucket: session.s3Bucket, key: session.s3Key }, deps);
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const sampleRows = rows.slice(0, 5);
    for (const candidate of buildCandidateLayouts(rawRows, headers)) {
      const activeSpec = await portfolioImportParserSpecService.findActiveSpecForShape({ appuser: input.appuser, broker: session.financialBrokerKey, headers: candidate.headers, layout: candidate.layout, tenant: input.tenant });
      const specSuggestion = await this.buildValidatedSpecSuggestion({ activeSpec, headers: candidate.headers });
      if (specSuggestion) {
        const normalizedSuggestion = normalizeMappingSuggestion(specSuggestion.suggestion, candidate.headers);
        session.columnMappingJson = { parserSpecContentHash: activeSpec?.contentHash, parserSpecKey: specSuggestion.parserSpecKey, source: 'spec', suggestion: normalizedSuggestion, version: 1 };
        await DI.em.persist(session).flush();
        return { columnMapping: normalizedSuggestion, importSessionId: session.portfolioImportSessionKey, mappingSource: 'saved_spec', status: session.status };
      }
      const heuristicSuggestion = buildLocalHeuristicSuggestion(candidate.headers);
      if (heuristicSuggestion) {
        session.columnMappingJson = { source: 'spec', suggestion: heuristicSuggestion, version: 1 };
        await DI.em.persist(session).flush();
        return { columnMapping: heuristicSuggestion, importSessionId: session.portfolioImportSessionKey, mappingSource: 'local_heuristic', status: session.status };
      }
    }

    try {
      const promptInput = sanitizePortfolioColumnMappingPromptInput({
        headers,
        rowShapes: rawRows.slice(0, 12).map((row) => ({ cellCount: row.length, emptyCellCount: row.filter((cell) => cell.trim() === '').length, nonEmptyCellCount: row.filter((cell) => cell.trim() !== '').length })),
        sampleRows: sampleRows.map((row, rowIndex) => ({ emptyCellCount: Object.values(row).filter((value) => !value.trim()).length, hasNumericCells: Object.values(row).some((value) => /\d/.test(value)), hasTextCells: Object.values(row).some((value) => /[A-Z]/i.test(value)), headerCount: headers.length, nonEmptyCellCount: Object.values(row).filter((value) => value.trim()).length, rowIndex })),
      });
      const { suggestion } = await requestPortfolioColumnMappingSuggestion(promptInput);
      const normalizedSuggestion = normalizeMappingSuggestion(suggestion, headers);
      session.columnMappingJson = { source: 'llm', suggestion: normalizedSuggestion, version: 1 };
      await DI.em.persist(session).flush();
      return { columnMapping: normalizedSuggestion, importSessionId: session.portfolioImportSessionKey, mappingSource: 'llm', status: session.status };
    } catch (error) {
      session.columnMappingJson = { source: 'error', version: 1, warning: AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING };
      session.summaryJson = { ...(session.summaryJson ?? {}), columnMappingWarning: AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING };
      await DI.em.persist(session).flush();
      logger.warn({ error, importSessionId: session.portfolioImportSessionKey }, 'Portfolio CSV column mapping LLM suggestion failed');
      return { importSessionId: session.portfolioImportSessionKey, mappingSource: 'disabled', status: session.status, warning: AUTOMATIC_COLUMN_MAPPING_UNAVAILABLE_WARNING };
    }
  }

  private buildDateFormatCandidates(configured: string | undefined, samples: string[]) {
    const hasCompact = samples.some((sample) => /^\d{8}(?:;\d{6})?$/.test(sample));
    const hasYearFirst = samples.some((sample) => /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(sample));
    const hasFirstTokenOverTwelve = samples.some((sample) => {
      const first = Number(sample.split(/[/-]/)[0]);
      return Number.isInteger(first) && first > 12;
    });
    const hasSecondTokenOverTwelve = samples.some((sample) => {
      const second = Number(sample.split(/[/-]/)[1]);
      return Number.isInteger(second) && second > 12;
    });
    const candidates = new Set<string>();
    if (configured) candidates.add(configured);
    if (hasCompact) { candidates.add('yyyyMMdd'); candidates.add('yyyyMMdd;HHmmss'); }
    if (hasYearFirst) candidates.add('yyyy-MM-dd');
    if (hasFirstTokenOverTwelve) candidates.add('dd/MM/yyyy');
    if (hasSecondTokenOverTwelve) candidates.add('MM/dd/yyyy');
    candidates.add('dd/MM/yyyy');
    candidates.add('MM/dd/yyyy');
    candidates.add('yyyy-MM-dd');
    return [...candidates];
  }

  private buildUtcDate(year: number | undefined, month: number | undefined, day: number | undefined) {
    if (year === undefined || month === undefined || day === undefined) return undefined;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return date;
  }

  private async buildValidatedSpecSuggestion(input: { activeSpec: Awaited<ReturnType<typeof portfolioImportParserSpecService.findActiveSpecForShape>>; headers: string[] }) {
    if (!input.activeSpec) return undefined;
    try {
      const payload = parsePortfolioImportParserSpecPayload(input.activeSpec.specJson);
      const resolvedColumns = resolveSpecColumnMapping({ actualHeaders: input.headers, columns: payload.columns });
      if (Object.keys(resolvedColumns).length === 0) {
        await portfolioImportParserSpecService.recordSpecFailure(input.activeSpec);
        return undefined;
      }

      const suggestion = portfolioColumnMappingSuggestionSchema.parse({ columnMapping: resolvedColumns, confidence: 1, derivedValues: payload.derivedValues, detectedBroker: null, fixedValues: payload.fixedValues, layout: payload.layout, transformations: payload.transformations, warnings: [] });
      validateConfirmedPortfolioColumnMapping({ columnMapping: suggestion.columnMapping, derivedValues: suggestion.derivedValues, fixedValues: suggestion.fixedValues, transformations: suggestion.transformations });
      return { parserSpecKey: input.activeSpec.portfolioImportParserSpecKey, suggestion };
    } catch {
      await portfolioImportParserSpecService.recordSpecFailure(input.activeSpec);
      return undefined;
    }
  }

  private collectDateSamples(rows: Record<string, string>[], dateColumn?: string) {
    if (!dateColumn) return [];
    return rows.map((row) => row[dateColumn]?.trim()).filter((value): value is string => Boolean(value));
  }

  private dateFormatParsesAllSamples(dateFormat: string, samples: string[]) {
    return samples.every((sample) => this.parseDateSample(sample, dateFormat));
  }

  private normalizeConfirmedRow(row: Record<string, string>, columnMapping: PortfolioColumnMapping, transformations: PortfolioColumnMappingTransformations, context: { brokerId?: number; portfolioId: number; tenantId: number }, fixedValues: PortfolioImportFixedValues = {}, derivedValues: PortfolioImportDerivedValues = {}) {
    const get = (key: keyof PortfolioColumnMapping) => columnMapping[key] ? row[columnMapping[key]] : undefined;
    const transactionDate = get('transactionDate');
    const quantityRaw = get('quantity');
    const totalAmountRaw = get('totalAmount');
    const unitPriceRaw = get('unitPrice');
    const feeAmountRaw = get('feeAmount');
    const externalTransactionId = this.trimCell(get('externalTransactionId'));
    const transactionTypeRaw = get('transactionType');
    const normalized: Record<string, unknown> = {};
    if (!transactionDate) throw new Error('Missing required transactionDate');
    normalized['date'] = this.parseDate(transactionDate, transformations.dateFormat);
    if (!quantityRaw) throw new Error('Missing required quantity');
    const quantity = parseMappedNumber(quantityRaw, transformations);
    const totalAmount = this.parseOptionalMappedNumber(totalAmountRaw, transformations);
    if (totalAmount !== undefined) normalized['totalAmount'] = totalAmount;
    const unitPrice = this.parseOptionalMappedNumber(unitPriceRaw, transformations);
    if (unitPrice !== undefined) normalized['unitPrice'] = unitPrice;
    else if (totalAmount !== undefined) {
      if (!Number.isFinite(quantity) || quantity === 0) throw new Error('Invalid derived unitPrice');
      const derivedUnitPrice = totalAmount / quantity;
      if (!Number.isFinite(derivedUnitPrice)) throw new Error('Invalid derived unitPrice');
      normalized['unitPrice'] = Math.abs(derivedUnitPrice);
    }
    const feeAmount = this.parseOptionalMappedNumber(feeAmountRaw, transformations);
    if (feeAmount !== undefined) normalized['feeAmount'] = feeAmount;
    const assetName = this.trimCell(get('assetName')); const ticker = this.trimCell(get('ticker')); const isin = this.trimCell(get('isin')); const currency = this.resolveCurrencyValue(get('currency'), columnMapping.currency, fixedValues.currency);
    if (!currency) throw new Error('Missing required currency');
    if (!assetName && !ticker && !isin) throw new Error('Missing required asset identity');
    normalized['assetName'] = assetName; normalized['ticker'] = ticker; normalized['isin'] = isin; normalized['settlementCurrencyCode'] = currency; normalized['externalTransactionId'] = externalTransactionId; normalized['assetSymbol'] = ticker ?? isin ?? assetName;
    const transactionType = this.normalizeTransactionType(transactionTypeRaw, transformations, totalAmountRaw, quantity, fixedValues.transactionType, derivedValues.transactionType);
    if (!transactionType) throw new Error('Unable to derive transaction type');
    normalized['transactionType'] = transactionType;
    normalized['quantity'] = Math.abs(quantity);
    const internalTransactionId = generatePortfolioImportInternalTransactionId({
      assetIdentity: { assetName, assetSymbol: normalized['assetSymbol'] as string | undefined, isin, ticker },
      brokerId: context.brokerId,
      externalTransactionId,
      feeAmount,
      portfolioId: context.portfolioId,
      quantity: normalized['quantity'] as number | undefined,
      rawRowFingerprint: undefined,
      settlementCurrency: currency,
      tenantId: context.tenantId,
      totalAmount,
      transactionDate: normalized['date'] as string,
      transactionType,
      unitPrice: normalized['unitPrice'] as number | undefined,
    });
    normalized['internalTransactionId'] = internalTransactionId;
    return normalized;
  }

  private normalizeDateFormat(dateFormat?: string) {
    const normalized = dateFormat?.trim();
    if (!normalized) return undefined;
    const upper = normalized.toUpperCase();
    if (upper === 'DD-MM-YYYY' || upper === 'DD/MM/YYYY') return 'dd/MM/yyyy';
    if (upper === 'MM-DD-YYYY' || upper === 'MM/DD/YYYY') return 'MM/dd/yyyy';
    if (upper === 'YYYY-MM-DD' || upper === 'YYYY/MM/DD') return 'yyyy-MM-dd';
    if (normalized === 'dd/MM/yyyy' || normalized === 'MM/dd/yyyy' || normalized === 'yyyy-MM-dd' || normalized === 'yyyyMMdd' || normalized === 'yyyyMMdd;HHmmss') return normalized;
    if (normalized === 'dd-MM-yyyy') return 'dd/MM/yyyy';
    if (normalized === 'yyyy/MM/dd') return 'yyyy-MM-dd';
    return normalized;
  }

  private normalizeTransactionType(transactionTypeRaw: string | undefined, transformations: PortfolioColumnMappingTransformations, totalAmount: string | undefined, quantity: number, fixedTransactionType?: 'BUY' | 'SELL', derivedTransactionType?: 'quantitySign' | 'totalAmountSign') {
    if (fixedTransactionType) return fixedTransactionType;
    const normalized = transactionTypeRaw?.trim().toUpperCase();
    if (normalized === 'BUY' || normalized === 'B' || normalized === 'PURCHASE') return 'BUY';
    if (normalized === 'SELL' || normalized === 'S' || normalized === 'SALE') return 'SELL';
    if (derivedTransactionType === 'quantitySign' || transformations.quantitySignIndicatesDirection) return quantity > 0 ? 'BUY' : 'SELL';
    if (derivedTransactionType === 'totalAmountSign' || transformations.negativeAmountMeansBuy) return totalAmount !== undefined && parseMappedNumber(totalAmount, transformations) < 0 ? 'BUY' : 'SELL';
    return undefined;
  }

  private parseCompactDate(trimmed: string) {
    const [datePart = ''] = trimmed.split(';'); const year = Number(datePart.slice(0, 4)); const month = Number(datePart.slice(4, 6)); const day = Number(datePart.slice(6, 8));
    return this.buildUtcDate(year, month, day);
  }

  private parseDate(value: string, dateFormat?: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Invalid transactionDate');
    const normalizedDateFormat = this.normalizeDateFormat(dateFormat);
    const parsed = this.parseDateWithConfiguredFormat(trimmed, normalizedDateFormat) ?? this.parseDateInferred(trimmed);
    if (!parsed || Number.isNaN(parsed.getTime())) throw new Error('Invalid transactionDate');
    return parsed.toISOString();
  }

  private parseDateInferred(trimmed: string) {
    if (/^\d{8}(?:;\d{6})?$/.test(trimmed)) return this.parseCompactDate(trimmed);
    const parts = trimmed.split(/[/-]/);
    if (parts.length !== 3) return undefined;
    const values = parts.map((part) => Number(part));
    if (values.some((part) => !Number.isInteger(part))) return undefined;
    const [first, second, third] = values;
    if (first !== undefined && first >= 1000) return this.parseSeparatedNumericDate(third, second, first);
    if (first !== undefined && first > 12) return this.parseSeparatedNumericDate(third, second, first);
    if (second !== undefined && second > 12) return this.parseSeparatedNumericDate(third, first, second);
    return this.parseSeparatedNumericDate(third, second, first);
  }

  private parseDateSample(value: string, dateFormat: string) {
    try {
      const trimmed = value.trim();
      const normalized = this.normalizeDateFormat(dateFormat);
      const parsed = this.parseDateWithConfiguredFormat(trimmed, normalized);
      return Boolean(parsed);
    } catch {
      return false;
    }
  }

  private parseDateWithConfiguredFormat(trimmed: string, normalizedDateFormat?: string) {
    if (normalizedDateFormat === 'yyyyMMdd' || normalizedDateFormat === 'yyyyMMdd;HHmmss' || /^\d{8}(?:;\d{6})?$/.test(trimmed)) return this.parseCompactDate(trimmed);
    if (!normalizedDateFormat || normalizedDateFormat === 'yyyy-MM-dd') return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? this.parseSeparatedDate(trimmed, 'yyyy-MM-dd') : undefined;
    if (normalizedDateFormat === 'dd/MM/yyyy') return this.parseSeparatedDate(trimmed, 'dd/MM/yyyy');
    if (normalizedDateFormat === 'MM/dd/yyyy') return this.parseSeparatedDate(trimmed, 'MM/dd/yyyy');
    return undefined;
  }

  private parseOptionalMappedNumber(value: string | undefined, transformations: PortfolioColumnMappingTransformations) {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return parseMappedNumber(trimmed, transformations);
  }

  private parseSeparatedDate(trimmed: string, format: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd') {
    const parts = trimmed.split(/[/-]/).map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part))) return undefined;
    if (format === 'yyyy-MM-dd') return this.parseSeparatedNumericDate(parts[0], parts[1], parts[2]);
    if (format === 'dd/MM/yyyy') return this.parseSeparatedNumericDate(parts[2], parts[1], parts[0]);
    return this.parseSeparatedNumericDate(parts[2], parts[0], parts[1]);
  }

  private parseSeparatedNumericDate(year: number | undefined, month: number | undefined, day: number | undefined) {
    return this.buildUtcDate(year, month, day);
  }

  private resolveCurrencyValue(currencyCell: string | undefined, currencyHeader: string | undefined, fixedCurrency?: string) {
    if (fixedCurrency) return fixedCurrency;
    const trimmed = this.trimCell(currencyCell);
    if (trimmed) return trimmed;
    const inferred = currencyHeader ? inferEmbeddedCurrency(currencyHeader) : undefined;
    return inferred?.currencyCode;
  }

  private resolveDateFormatForRows(rows: Record<string, string>[], columnMapping: PortfolioColumnMapping, transformations: PortfolioColumnMappingTransformations) {
    const configured = this.normalizeDateFormat(transformations.dateFormat);
    const samples = this.collectDateSamples(rows, columnMapping.transactionDate);
    const orderedCandidates = this.buildDateFormatCandidates(configured, samples);
    for (const candidate of orderedCandidates) {
      if (this.dateFormatParsesAllSamples(candidate, samples)) return { ...transformations, dateFormat: candidate };
    }
    return { ...transformations, dateFormat: 'dd/MM/yyyy' };
  }

  private async saveConfirmedParserSpecIfPossible(input: { appuser: Appuser; confirmed: { columnMapping: PortfolioColumnMapping; derivedValues: PortfolioImportDerivedValues; fixedValues: PortfolioImportFixedValues; transformations: PortfolioColumnMappingTransformations }; confirmedInput: ConfirmPortfolioColumnMappingInput; invalidRows: number; rawRows: string[][] | undefined; readyRows: number; rows: Record<string, string>[]; session: { columnMappingJson?: Record<string, unknown>; financialBrokerKey?: { financialBrokerKey: number } }; suggestionSource: 'llm' | 'spec' | 'user' }) {
    if (input.readyRows <= 0 && input.invalidRows <= 0) return;
    try {
      const headers = input.rawRows ? (input.rawRows[input.confirmedInput.layout.headerRowIndex ?? 0] ?? []) : Object.keys(input.rows[0] ?? {});
      const payload = buildPortfolioImportParserSpecPayload({ columnMapping: input.confirmed.columnMapping, derivedValues: input.confirmed.derivedValues, fixedValues: input.confirmed.fixedValues, headers, layout: input.confirmedInput.layout, transformations: input.confirmed.transformations });
      const confirmedContentHash = hashPortfolioImportParserSpecPayload(payload);
      const appliedParserSpecKey = input.session.columnMappingJson?.['appliedParserSpecKey'];
      const appliedParserSpecContentHash = input.session.columnMappingJson?.['appliedParserSpecContentHash'];
      if (input.invalidRows > 0) {
        if (typeof appliedParserSpecKey === 'number' && appliedParserSpecContentHash === confirmedContentHash) {
          try { await portfolioImportParserSpecService.recordSpecFailureByKey({ contentHash: confirmedContentHash, parserSpecKey: appliedParserSpecKey }); } catch (error) { logger.warn({ error, importSessionId: input.confirmedInput.importSessionId, parserSpecKey: appliedParserSpecKey }, 'Portfolio import parser spec confirmation failure feedback failed'); }
        }
        return;
      }
      const spec = await portfolioImportParserSpecService.saveConfirmedSpec({ appuser: input.appuser, broker: input.session.financialBrokerKey, columnMapping: input.confirmed.columnMapping, derivedValues: input.confirmed.derivedValues, fixedValues: input.confirmed.fixedValues, headers, layout: input.confirmedInput.layout, suggestionSource: input.suggestionSource, tenant: input.confirmedInput.tenant, transformations: input.confirmed.transformations });
      input.session.columnMappingJson = { ...(input.session.columnMappingJson ?? {}), candidateParserSpecContentHash: spec.contentHash, candidateParserSpecKey: spec.portfolioImportParserSpecKey, parserSpecKey: spec.portfolioImportParserSpecKey, parserSpecPromotion: { candidateParserSpecKey: spec.portfolioImportParserSpecKey, status: 'awaiting_finalization' } };
      await DI.em.persist(input.session).flush();
    } catch (error) {
      logger.warn({ brokerId: input.session.financialBrokerKey?.financialBrokerKey, error, importSessionId: input.confirmedInput.importSessionId, tenantId: input.confirmedInput.tenant.tenantKey }, 'Portfolio import parser spec candidate save failed');
    }
  }

  private trimCell(value: string | undefined) { const trimmed = value?.trim(); return trimmed ? trimmed : undefined; }
}

function buildCandidateLayouts(rawRows: string[][], headers: string[]) {
  const candidates: { headers: string[]; layout: PortfolioCsvLayout }[] = [{ headers, layout: { dataStartRowIndex: 1, headerRowIndex: 0 } }];
  const seen = new Set<string>([candidateKey(headers, 0, 1)]);
  for (let index = 0; index < Math.min(rawRows.length, 12); index += 1) {
    const row = rawRows[index] ?? [];
    if (row.every((cell) => cell.trim() === '')) continue;
    const candidateHeaders = row.filter((cell) => cell.trim() !== '');
    const key = candidateKey(candidateHeaders, index, index + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ headers: candidateHeaders, layout: { dataStartRowIndex: index + 1, headerRowIndex: index } });
  }
  return candidates;
}

function buildLocalHeuristicSuggestion(headers: string[]): PortfolioColumnMappingSuggestion | undefined {
  const mapping = Object.fromEntries(portfolioColumnMappingFields.map((field) => [field, undefined])) as Record<(typeof portfolioColumnMappingFields)[number], string | undefined>;
  for (const header of headers) {
    const normalized = normalizeCsvHeader(header);
    if (!mapping.transactionDate && /(?:^|\b)(?:date|trade date|transaction date)(?:\b|$)/.test(normalized)) mapping.transactionDate = header;
    else if (!mapping.quantity && /(?:^|\b)(?:qty|quantity|shares?)(?:\b|$)/.test(normalized)) mapping.quantity = header;
    else if (!mapping.unitPrice && /(?:^|\b)(?:unit price|price)(?:\b|$)/.test(normalized)) mapping.unitPrice = header;
    else if (!mapping.totalAmount && /(?:^|\b)(?:total|amount|value)(?:\b|$)/.test(normalized)) mapping.totalAmount = header;
    else if (!mapping.currency && /(?:^|\b)(?:currency|ccy)(?:\b|$)/.test(normalized)) mapping.currency = header;
    else if (!mapping.isin && /(?:^|\b)isin(?:\b|$)/.test(normalized)) mapping.isin = header;
    else if (!mapping.ticker && /(?:^|\b)(?:ticker|symbol)(?:\b|$)/.test(normalized)) mapping.ticker = header;
    else if (!mapping.assetName && /(?:^|\b)(?:asset|name|product|security)(?:\b|$)/.test(normalized)) mapping.assetName = header;
    else if (!mapping.transactionType && /(?:^|\b)(?:type|side)(?:\b|$)/.test(normalized)) mapping.transactionType = header;
    else if (!mapping.externalTransactionId && /(?:^|\b)(?:external id|transaction id|id)(?:\b|$)/.test(normalized)) mapping.externalTransactionId = header;
    else if (!mapping.brokerExchange && /(?:^|\b)(?:exchange|market|venue)(?:\b|$)/.test(normalized)) mapping.brokerExchange = header;
    else if (!mapping.feeAmount && /(?:^|\b)(?:fee|commission)(?:\b|$)/.test(normalized)) mapping.feeAmount = header;
  }

  try {
    const suggestion = portfolioColumnMappingSuggestionSchema.parse({ columnMapping: mapping, confidence: 0.6, detectedBroker: null, layout: { dataStartRowIndex: 1, headerRowIndex: 0 }, transformations: {}, warnings: ['local heuristic'] });
    validateConfirmedPortfolioColumnMapping({ columnMapping: suggestion.columnMapping, derivedValues: suggestion.derivedValues, fixedValues: suggestion.fixedValues, transformations: suggestion.transformations });
    return suggestion;
  } catch {
    return undefined;
  }
}

function candidateKey(headers: string[], headerRowIndex: number, dataStartRowIndex: number) { return `${headerRowIndex}:${dataStartRowIndex}:${headers.join('\u001f')}`; }

function csvRowsToRecords(rows: string[][]): Record<string, string>[] {
  const header = rows[0] ?? [];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((cell, index) => [cell, row[index] ?? ''])));
}

async function defaultResolveImportSessionAssets(input: { importSessionId: number }) {
  const { default: service } = await import('./portfolio-import-asset-resolution.service');
  return service.resolveImportSessionAssets(input);
}

function inferEmbeddedCurrency(header: string) {
  const match = /\b([A-Z]{3})\b/.exec(header.toUpperCase());
  if (!match) return undefined;
  if (!['value', 'total', 'price', 'amount'].some((term) => header.toLowerCase().includes(term))) return undefined;
  return { currencyCode: match[1] };
}

function isPlainDefaultLayout(layout: PortfolioCsvLayout) {
  return layout.headerRowIndex === 0 && layout.dataStartRowIndex === 1 && layout.footerRowCount === undefined && layout.footerMatchers === undefined;
}

function normalizeMappingSuggestion(suggestion: PortfolioColumnMappingSuggestion, headers: string[]) {
  const normalized = { ...suggestion, columnMapping: { ...suggestion.columnMapping }, derivedValues: { ...suggestion.derivedValues }, fixedValues: { ...suggestion.fixedValues }, warnings: [...suggestion.warnings] };
  for (const key of portfolioColumnMappingFields) {
    const mapped = normalized.columnMapping[key];
    if (!mapped) continue;
    const exact = headers.find((header) => header.trim().toLowerCase() === mapped.trim().toLowerCase());
    if (exact) normalized.columnMapping[key] = exact;
  }
  const currencyMapping = normalized.columnMapping.currency;
  if (currencyMapping) {
    const inferred = inferEmbeddedCurrency(currencyMapping);
    if (inferred) {
      normalized.columnMapping.currency = undefined;
      normalized.fixedValues.currency = inferred.currencyCode as PortfolioImportFixedValues['currency'];
      normalized.transformations = { ...normalized.transformations };
      if (!normalized.warnings.some((warning) => warning.includes('currency'))) normalized.warnings.push(`Currency appears embedded in value column; inferred ${inferred.currencyCode}`);
    }
  }
  return normalized;
}

function normalizeSpreadsheetRows(rows: unknown[][]): string[][] {
  return rows.map((row) => row.map((cell) => cell === null || cell === undefined ? '' : String(cell)));
}

async function parseColumnMappingRows(input: { bucket: string; key: string; layout: PortfolioCsvLayout }, deps: ConfirmPortfolioColumnMappingDeps): Promise<{ rawRows?: string[][]; rows: Record<string, string>[] }> {
  const useDefaultParseRows = isPlainDefaultLayout(input.layout);
  try {
    const csvText = await getLimitedCsvObjectText({ bucket: input.bucket, key: input.key }, { getObjectSize: deps.getObjectSize, getObjectText: deps.getObjectText });
    if (useDefaultParseRows) return { rows: (deps.parseCsvRows ?? parseCsvRows)<Record<string, string>>(csvText) };
    const rawRows = parseRawCsvRowsForLayout(csvText);
    return { rawRows, rows: applyPortfolioCsvLayout(rawRows, input.layout) };
  } catch (textError) {
    if (deps.parseCsvRows || deps.getObjectText && !deps.getObjectBuffer) throw textError;
    const rawRows = await parseSpreadsheetObjectRows(input, deps);
    return { rawRows, rows: useDefaultParseRows ? csvRowsToRecords(rawRows) : applyPortfolioCsvLayout(rawRows, input.layout) };
  }
}

async function parseColumnMappingSuggestionRows(input: { bucket: string; key: string }, deps: { getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>; getObjectText?: (bucket: string, key: string) => Promise<string>; parseCsvRows?: typeof parseCsvRows }): Promise<{ rawRows: string[][]; rows: Record<string, string>[] }> {
  try {
    const csvText = await getLimitedCsvObjectText({ bucket: input.bucket, key: input.key }, { getObjectSize: deps.getObjectSize, getObjectText: deps.getObjectText });
    const rawRows = parseRawCsvRowsForLayout(csvText);
    let rows: Record<string, string>[] = [];
    try { rows = (deps.parseCsvRows ?? parseCsvRows)<Record<string, string>>(csvText); } catch { rows = []; }
    return { rawRows, rows };
  } catch (textError) {
    if (deps.parseCsvRows || deps.getObjectText && !deps.getObjectBuffer) throw textError;
    const rawRows = await parseSpreadsheetObjectRows(input, deps);
    let rows: Record<string, string>[] = [];
    try { rows = csvRowsToRecords(rawRows); } catch { rows = []; }
    return { rawRows, rows };
  }
}

async function parseSpreadsheetObjectRows(input: { bucket: string; key: string }, deps: { getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined> }): Promise<string[][]> {
  const buffer = await getLimitedCsvObjectBuffer({ bucket: input.bucket, key: input.key }, { getObjectBuffer: deps.getObjectBuffer, getObjectSize: deps.getObjectSize });
  return normalizeSpreadsheetRows(await csv.parseExcel(buffer) as unknown[][]);
}

function resolveConfirmColumnMappingResult(session: { portfolioImportSessionKey: number; status: PortfolioImportSessionStatus; summaryJson?: Record<string, unknown> }, fallback: { blockingRows: number; canConfirm: boolean; duplicateRows: number; invalidRows: number; readyRows: number; skippedRows: number; totalRows: number }) {
  const summary = session.summaryJson ?? {};
  const count = (key: string, fallbackValue: number) => {
    const value = summary[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue;
  };
  return {
    assetGroups: summary['assetGroups'],
    blockingRows: count('blockingRows', fallback.blockingRows),
    canConfirm: typeof summary['canConfirm'] === 'boolean' ? summary['canConfirm'] : fallback.canConfirm,
    duplicateRows: count('duplicateRows', fallback.duplicateRows),
    importableRows: count('importableRows', fallback.readyRows),
    importSessionId: session.portfolioImportSessionKey,
    invalidRows: count('invalidRows', fallback.invalidRows),
    needsAssetReviewRows: count('needsAssetReviewRows', 0),
    readyRows: count('readyRows', fallback.readyRows),
    skippedRows: count('skippedRows', fallback.skippedRows),
    status: session.status,
    totalRows: count('totalRows', fallback.totalRows),
    unsupportedAssets: summary['unsupportedAssets'],
  };
}

function summarizeInvalidRows(rows: { failureReason: string; rowNumber: number }[]) {
  const reasons = new Map<string, number>();
  for (const row of rows) reasons.set(row.failureReason, (reasons.get(row.failureReason) ?? 0) + 1);
  return { reasons: [...reasons.entries()].slice(0, 5).map(([reason, count]) => ({ count, reason })), rowNumbers: rows.slice(0, 10).map((row) => row.rowNumber) };
}

export default new PortfolioCsvColumnMappingService();
