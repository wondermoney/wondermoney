import { csv } from '@wondermoney/shared';

import { DI } from '@app/database/di';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioImportRow, PortfolioImportRowStatus } from '@entity/PortfolioImportRow';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import { getLimitedCsvObjectBuffer } from '@service/account/csv-upload-boundary.service';
import { getLimitedCsvObjectText, parseCsvRows } from '@service/account/csv-upload-boundary.service';
import { ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import type { PortfolioImportAssetResolutionResult } from './portfolio-import-asset-resolution.service';
import { canConfirm, recomputeImportSessionStatus } from './portfolio-import-session-state';

export interface ParsePreviewDeps {
  getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>;
  getObjectText?: (bucket: string, key: string) => Promise<string>;
  parseCsvRows?: <T>(csvText: string) => Promise<T[]> | T[];
  resolveImportSessionAssets?: (input: { importSessionId: number }) => Promise<PortfolioImportAssetResolutionResult>;
}

export interface PortfolioCsvParsePreviewResult {
  blockingRows: number;
  duplicateRows: number;
  importableRows: number;
  invalidRows: number;
  needsAssetReviewRows: number;
  readyRows: number;
  skippedRows: number;
  status: PortfolioImportSessionStatus;
  totalRows: number;
  userSkippedRows: number;
}

type ParsedPreviewRow = Record<string, unknown>;

const REQUIRED_FIELDS = ['date', 'assetSymbol', 'transactionTypeId', 'quantity', 'unitPrice', 'settlementCurrencyId', 'internalTransactionId'] as const;

export default class PortfolioCsvParsePreviewService {
  async parseImportSession(input: { importSessionId: number }, deps: ParsePreviewDeps = {}): Promise<PortfolioCsvParsePreviewResult> {
    const session = await DI.em.findOne(PortfolioImportSession, { deletedAt: undefined, portfolioImportSessionKey: input.importSessionId }, { populate: ['portfolioKey', 'appuserKey', 'tenantKey', 'financialBrokerKey'] });
    if (!session) throw new NotFoundError('Import session not found');
    if (session.status !== PortfolioImportSessionStatus.PARSING) throw new ConflictError('Import session cannot be parsed');

    const classification = await this.classifyRows(session, deps);
    if ('status' in classification) {
      session.status = classification.status;
      session.summaryJson = { ...(session.summaryJson ?? {}), ...classification.summary, status: classification.status };
      await DI.em.persist(session).flush();
      return {
        blockingRows: Number(classification.summary['blockingRows'] ?? 0),
        duplicateRows: Number(classification.summary['duplicateRows'] ?? 0),
        importableRows: Number(classification.summary['importableRows'] ?? 0),
        invalidRows: Number(classification.summary['invalidRows'] ?? 0),
        needsAssetReviewRows: Number(classification.summary['needsAssetReviewRows'] ?? 0),
        readyRows: Number(classification.summary['readyRows'] ?? 0),
        skippedRows: Number(classification.summary['userSkippedRows'] ?? 0),
        status: classification.status,
        totalRows: Number(classification.summary['totalRows'] ?? 0),
        userSkippedRows: Number(classification.summary['userSkippedRows'] ?? 0),
      };
    }

    const { rows } = classification;
    const persistedRows: PortfolioImportRow[] = [];
    let readyRows = 0;
    let duplicateRows = 0;
    let invalidRows = 0;
    const needsAssetReviewRows = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      const normalized = this.normalizeRow(row);
      const validationError = this.validateNormalizedRow(normalized);
      const previewRow = new PortfolioImportRow();
      previewRow.portfolioImportSessionKey = session;
      previewRow.rawJson = row;
      previewRow.rowNumber = rowNumber;

      if (validationError) {
        invalidRows++;
        previewRow.status = PortfolioImportRowStatus.INVALID;
        previewRow.failureReason = validationError;
        persistedRows.push(previewRow);
        continue;
      }

      const internalTransactionId = String(normalized.internalTransactionId);
      const existing = await DI.em.findOne(FinancialTransaction, { internalTransactionId });
      previewRow.internalTransactionId = internalTransactionId;
      previewRow.normalizedJson = normalized;

      if (existing) {
        duplicateRows++;
        previewRow.status = PortfolioImportRowStatus.DUPLICATE;
        previewRow.skipReason = 'Duplicate internalTransactionId';
      } else {
        readyRows++;
        previewRow.status = PortfolioImportRowStatus.READY;
      }

      persistedRows.push(previewRow);
      }

    const totalRows = rows.length;
    const importableRows = readyRows;
    const blockingRows = duplicateRows + invalidRows + needsAssetReviewRows;
    const userSkippedRows = 0;
    const skippedRows = userSkippedRows;
    const status = recomputeImportSessionStatus(persistedRows, []);
    session.status = status;
    session.summaryJson = { ...(session.summaryJson ?? {}), blockingRows, canConfirm: false, duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status, totalRows, userSkippedRows };
    // Consolidated: transitions confirm rule (was `readyRows > 0`). Computed after
    // the summary is in place so the predicate can read row counts.
    const confirmable = canConfirm(session);
    session.summaryJson = { ...session.summaryJson, canConfirm: confirmable };
    await DI.em.persist([session, ...persistedRows]).flush();
    const resolveImportSessionAssets = deps.resolveImportSessionAssets ?? defaultResolveImportSessionAssets;
    if (readyRows > 0) {
      try {
        const resolution = await resolveImportSessionAssets({ importSessionId: input.importSessionId });
        const resolvedStatus = resolution.status === PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW ? PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW : session.status;
        if (resolvedStatus !== session.status) session.status = resolvedStatus;
        session.summaryJson = { ...(session.summaryJson ?? {}), blockingRows, canConfirm: canConfirm(session), duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status: session.status, totalRows, userSkippedRows };
        await DI.em.persist(session).flush();
        return { blockingRows, duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status: session.status, totalRows, userSkippedRows };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        session.status = PortfolioImportSessionStatus.NEEDS_ASSET_REVIEW;
        session.summaryJson = { ...(session.summaryJson ?? {}), assetResolutionError: { code: 'ASSET_RESOLUTION_FAILED', message }, blockingRows, canConfirm: canConfirm(session), duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status: session.status, totalRows, userSkippedRows };
        await DI.em.persist(session).flush();
        return { blockingRows, duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status: session.status, totalRows, userSkippedRows };
      }
    }
    return { blockingRows, duplicateRows, importableRows, invalidRows, needsAssetReviewRows, readyRows, skippedRows, status, totalRows, userSkippedRows };
  }

  private async classifyRows(session: PortfolioImportSession, deps: ParsePreviewDeps): Promise<{ rows: ParsedPreviewRow[] } | { rows?: never; status: PortfolioImportSessionStatus; summary: Record<string, unknown> }> {
    let source: Buffer | string;
    try {
      source = await this.getSource(session, deps);
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'CSV object read failed';
      logger.error({ error, importSessionId: session.portfolioImportSessionKey, s3BucketPresent: Boolean(session.s3Bucket), s3KeyPresent: Boolean(session.s3Key) }, 'Portfolio CSV parse preview failed to read upload object');
      return { status: PortfolioImportSessionStatus.FAILED, summary: { errorCode: this.errorCodeFor(error), failureReason, totalRows: 0 } };
    }

    try {
      const rows = typeof source === 'string'
        ? await this.parseRowsFromText(source, deps)
        : await (csv.parseExcel(source) as Promise<ParsedPreviewRow[]>);
      if (!rows.length) return { status: PortfolioImportSessionStatus.FAILED, summary: { errorCode: 'EMPTY_CSV', totalRows: 0 } };
      if (!this.hasSupportedShape(rows)) return { status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING, summary: { parserError: 'UNSUPPORTED_SHAPE', totalRows: rows.length } };
      return { rows };
    } catch (error) {
      const errorCode = this.errorCodeFor(error);
      return { status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING, summary: { errorCode, parserError: 'CSV_PARSE_FAILED', totalRows: 0 } };
    }
  }

  private errorCodeFor(error: unknown) {
    return error instanceof Error ? error.message.replace(/\s+/g, '_').toUpperCase() : 'UNKNOWN_ERROR';
  }

  private async getSource(session: PortfolioImportSession, deps: ParsePreviewDeps): Promise<Buffer | string> {
    const bucket = session.s3Bucket as string | undefined;
    const key = session.s3Key as string | undefined;
    if (!bucket?.trim()) throw new Error('Portfolio import upload bucket is missing');
    if (!key?.trim()) throw new Error('Portfolio import upload key is missing');
    if (deps.parseCsvRows) {
      return getLimitedCsvObjectText({ bucket, key }, { getObjectSize: deps.getObjectSize, getObjectText: deps.getObjectText });
    }
    return getLimitedCsvObjectBuffer({ bucket, key }, { getObjectSize: deps.getObjectSize });
  }

  private hasSupportedShape(rows: ParsedPreviewRow[]) {
    const row = rows[0];
    if (!row) return false;
    return REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(row, field));
  }

  private normalizeRow(row: ParsedPreviewRow) {
    return {
      assetSymbol: row['assetSymbol'],
      date: this.toIsoDate(row['date']),
      internalTransactionId: row['internalTransactionId'],
      quantity: this.toNumber(row['quantity']),
      settlementCurrencyId: this.toInt(row['settlementCurrencyId']),
      transactionTypeId: this.toInt(row['transactionTypeId']),
      unitPrice: this.toNumber(row['unitPrice']),
    };
  }

  private async parseRowsFromText(csvText: string, deps: ParsePreviewDeps): Promise<ParsedPreviewRow[]> {
    return deps.parseCsvRows ? await deps.parseCsvRows<ParsedPreviewRow>(csvText) : (parseCsvRows<ParsedPreviewRow>(csvText));
  }

  private toInt(value: unknown) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  private toIsoDate(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  private toNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private validateNormalizedRow(row: ReturnType<PortfolioCsvParsePreviewService['normalizeRow']>) {
    for (const field of REQUIRED_FIELDS) {
      if (row[field] === undefined || row[field] === null || row[field] === '') return `Missing required field: ${field}`;
    }
    if (!row.date) return 'Invalid date';
    return undefined;
  }
}

async function defaultResolveImportSessionAssets(input: { importSessionId: number }) {
  const { default: service } = await import('./portfolio-import-asset-resolution.service');
  return service.resolveImportSessionAssets(input);
}
