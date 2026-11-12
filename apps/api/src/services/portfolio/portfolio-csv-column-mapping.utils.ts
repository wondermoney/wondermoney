import { createHash } from 'node:crypto';

import type { PortfolioCsvColumnMappingOpenAIInput } from './portfolio-csv-column-mapping-openai';
import { portfolioColumnMappingFields, type PortfolioColumnMappingSuggestion, type PortfolioColumnMappingTransformations, type PortfolioImportFixedValues } from './portfolio-csv-column-mapping.schema';

export function generatePortfolioImportInternalTransactionId(input: {
  assetIdentity?: { assetName?: string; assetSymbol?: string; isin?: string; ticker?: string };
  brokerId?: number | string;
  externalTransactionId?: string;
  feeAmount?: number | string;
  feeCurrency?: number | string;
  portfolioId: number | string;
  quantity?: number | string;
  rawRowFingerprint?: string;
  settlementCurrency?: number | string;
  tenantId: number | string;
  totalAmount?: number | string;
  transactionDate?: Date | string;
  transactionType?: string;
  unitPrice?: number | string;
}): string {
  const normalizedExternalTransactionId = normalizeString(input.externalTransactionId);
  if (normalizedExternalTransactionId) {
    return hashIdentity({ brokerId: input.brokerId, externalTransactionId: normalizedExternalTransactionId, portfolioId: input.portfolioId, tenantId: input.tenantId }, 'external');
  }

  const canonical = canonicalizeCanonicalFields({
    assetIdentity: input.assetIdentity,
    brokerId: input.brokerId,
    feeAmount: input.feeAmount,
    feeCurrency: input.feeCurrency,
    portfolioId: input.portfolioId,
    quantity: input.quantity,
    rawRowFingerprint: input.rawRowFingerprint,
    settlementCurrency: input.settlementCurrency,
    tenantId: input.tenantId,
    totalAmount: input.totalAmount,
    transactionDate: input.transactionDate,
    transactionType: input.transactionType,
    unitPrice: input.unitPrice,
  });
  return `portfolio-import:row-hash:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

export function parseMappedNumber(value: string, transformations: PortfolioColumnMappingTransformations): number {
  if (transformations.decimalSeparator && transformations.thousandsSeparator && transformations.thousandsSeparator !== 'none' && transformations.decimalSeparator === transformations.thousandsSeparator) throw new Error('decimalSeparator and thousandsSeparator must differ unless thousandsSeparator is none');
  const trimmed = value.trim(); if (!trimmed) throw new Error('mapped number is empty');
  let normalized = trimmed; const thousands = transformations.thousandsSeparator; const decimalSeparator = transformations.decimalSeparator;
  if (thousands && thousands !== 'none') normalized = thousands === ' ' ? normalized.replace(/\s+/g, '') : normalized.split(thousands).join('');
  if (decimalSeparator && decimalSeparator !== '.') normalized = normalized.replace(decimalSeparator, '.');
  if (!decimalSeparator && !thousands) normalized = inferCommonBrokerNumber(normalized);
  const parsed = Number(normalized); if (!Number.isFinite(parsed)) throw new Error(`invalid mapped number: ${value}`); return parsed;
}

function canonicalizeCanonicalFields(input: { assetIdentity?: { assetName?: string; assetSymbol?: string; isin?: string; ticker?: string }; brokerId?: number | string; feeAmount?: number | string; feeCurrency?: number | string; portfolioId: number | string; quantity?: number | string; rawRowFingerprint?: string; settlementCurrency?: number | string; tenantId: number | string; totalAmount?: number | string; transactionDate?: Date | string; transactionType?: string; unitPrice?: number | string }) {
  /* eslint-disable perfectionist/sort-objects -- Preserve row-hash canonical JSON key order for backwards-compatible internalTransactionId generation. */
  const normalized = {
    assetIdentity: normalizeValue(input.assetIdentity ?? {}),
    brokerId: input.brokerId ?? null,
    rawRowFingerprint: input.rawRowFingerprint ?? null,
    portfolioId: String(input.portfolioId),
    tenantId: String(input.tenantId),
    transactionDate: normalizeValue(input.transactionDate),
    transactionType: normalizeValue(input.transactionType),
    quantity: normalizeValue(input.quantity),
    unitPrice: normalizeValue(input.unitPrice),
    totalAmount: normalizeValue(input.totalAmount),
    settlementCurrency: normalizeValue(input.settlementCurrency),
    feeAmount: normalizeValue(input.feeAmount),
    feeCurrency: normalizeValue(input.feeCurrency),
  };
  /* eslint-enable perfectionist/sort-objects */
  return JSON.stringify(normalized);
}

function hashIdentity(input: { brokerId?: number | string; externalTransactionId: string; portfolioId: number | string; tenantId: number | string }, kind: 'external' | 'row-hash') {
  return `portfolio-import:${kind}:${createHash('sha256').update(JSON.stringify({ brokerId: input.brokerId ?? null, externalTransactionId: input.externalTransactionId, portfolioId: String(input.portfolioId), tenantId: String(input.tenantId) })).digest('hex').slice(0, 32)}`;
}

function inferCommonBrokerNumber(input: string) {
  if (/^-?\d{1,3}(?:[\s,.]\d{3})+[,.]\d+$/.test(input)) {
    const decimal = input.lastIndexOf(',') > input.lastIndexOf('.') ? ',' : '.';
    return input.replace(/[\s,.](?=\d{3}(?:[\s,.]|$))/g, '').replace(decimal, '.');
  }
  if (/^-?\d+[,.]\d+$/.test(input)) return input.replace(',', '.');
  return input.replace(/\s+/g, '');
}

function normalizeString(value: string | undefined) { return value?.trim(); }

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, normalizeValue(nested)] as const)
      .sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
}

/**
 * What the column-mapping model is shown for a file: the header names, the shape of the first raw
 * rows and a count-only profile of the first data rows. No cell value beyond the header row is
 * sent. `rows` are the file read with its first row as the header.
 */
export function buildPortfolioColumnMappingPromptInput(input: { rawRows: string[][]; rows: Record<string, string>[] }): PortfolioCsvColumnMappingOpenAIInput {
  const headers = input.rows[0] ? Object.keys(input.rows[0]) : [];
  return {
    headers,
    rowShapes: input.rawRows.slice(0, 12).map((row) => ({ cellCount: row.length, emptyCellCount: row.filter((cell) => cell.trim() === '').length, nonEmptyCellCount: row.filter((cell) => cell.trim() !== '').length })),
    sampleRows: input.rows.slice(0, 5).map((row, rowIndex) => ({ emptyCellCount: Object.values(row).filter((value) => !value.trim()).length, hasNumericCells: Object.values(row).some((value) => /\d/.test(value)), hasTextCells: Object.values(row).some((value) => /[A-Z]/i.test(value)), headerCount: headers.length, nonEmptyCellCount: Object.values(row).filter((value) => value.trim()).length, rowIndex })),
  };
}

export function inferEmbeddedCurrency(header: string) {
  const match = /\b([A-Z]{3})\b/.exec(header.toUpperCase());
  if (!match) return undefined;
  if (!['value', 'total', 'price', 'amount'].some((term) => header.toLowerCase().includes(term))) return undefined;
  return { currencyCode: match[1] };
}

/**
 * A suggestion as the import shows it: each mapped column spelled as the file spells it, and a
 * currency written into a value column's name ("Total EUR") read as a fixed currency.
 */
export function normalizePortfolioColumnMappingSuggestion(suggestion: PortfolioColumnMappingSuggestion, headers: string[]) {
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
