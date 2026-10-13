import { createHash } from 'node:crypto';

import { type PortfolioColumnMappingTransformations } from './portfolio-csv-column-mapping.schema';

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
