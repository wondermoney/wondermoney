import { createHash } from 'node:crypto';

export interface PortfolioImportAssetIdentity {
  brokerAssetName?: string;
  brokerExchange?: string;
  brokerTicker?: string;
  currency?: string;
  isin?: string;
}

interface PortfolioImportAssetCandidate {
  currency?: string;
  exchange?: string;
  isin?: string;
  name?: string;
  symbol?: string;
}

export function buildPortfolioImportAssetIdentityHash(identity: PortfolioImportAssetIdentity): string {
  const canonical = JSON.stringify([
    normalizeUpper(identity.isin),
    normalizeUpper(identity.brokerTicker),
    normalizeUpper(identity.brokerExchange),
    normalizeAssetName(identity.brokerAssetName),
    normalizeUpper(identity.currency),
  ]);

  return createHash('sha256').update(canonical).digest('hex');
}

export function extractPortfolioImportAssetIdentity(normalizedJson?: Record<string, unknown>): PortfolioImportAssetIdentity | undefined {
  if (!normalizedJson) return undefined;

  const isin = normalizeUpper(readString(normalizedJson, 'isin'));
  const ticker = normalizeUpper(readString(normalizedJson, 'ticker'));
  const brokerTicker = ticker ?? normalizeUpper(readString(normalizedJson, 'brokerTicker')) ?? normalizeUpper(readString(normalizedJson, 'assetSymbol'));
  const brokerExchange = normalizeUpper(readString(normalizedJson, 'brokerExchange'));
  const brokerAssetName = normalizeReadableName(readString(normalizedJson, 'assetName') ?? readString(normalizedJson, 'brokerAssetName'));
  const currency = normalizeUpper(readString(normalizedJson, 'settlementCurrencyCode') ?? readString(normalizedJson, 'currency'));

  if (!isin && !brokerTicker && !brokerAssetName) return undefined;

  const identity: PortfolioImportAssetIdentity = {};
  if (isin) identity.isin = isin;
  if (brokerTicker) identity.brokerTicker = brokerTicker;
  if (brokerExchange) identity.brokerExchange = brokerExchange;
  if (brokerAssetName) identity.brokerAssetName = brokerAssetName;
  if (currency) identity.currency = currency;
  return identity;
}

export function scorePortfolioImportAssetCandidate(identity: PortfolioImportAssetIdentity, candidate: PortfolioImportAssetCandidate): { confidence: number; rejectedReason?: string } {
  const identityIsin = normalizeUpper(identity.isin);
  const identityTicker = normalizeUpper(identity.brokerTicker);
  const identityExchange = normalizeUpper(identity.brokerExchange);
  const identityCurrency = normalizeUpper(identity.currency);
  const identityName = normalizeName(identity.brokerAssetName);

  const candidateIsin = normalizeUpper(candidate.isin);
  const candidateTicker = normalizeUpper(candidate.symbol);
  const candidateExchange = normalizeUpper(candidate.exchange);
  const candidateCurrency = normalizeUpper(candidate.currency);
  const candidateName = normalizeName(candidate.name);

  if (identityIsin && candidateIsin && identityIsin === candidateIsin) return { confidence: 1 };
  if (identityIsin && candidateIsin && identityIsin !== candidateIsin) return { confidence: 0.1, rejectedReason: 'isin_mismatch' };

  if (identityTicker && candidateTicker && identityTicker === candidateTicker && identityExchange && candidateExchange && identityExchange !== candidateExchange) {
    return { confidence: 0.25, rejectedReason: 'exchange_mismatch' };
  }

  if (identityCurrency && candidateCurrency && identityCurrency !== candidateCurrency) {
    if (identityTicker && candidateTicker && identityTicker === candidateTicker) return { confidence: 0.1, rejectedReason: 'currency_mismatch' };
    if (identityName && candidateName && identityName === candidateName) return { confidence: 0.1, rejectedReason: 'currency_mismatch' };
  }

  if (identityTicker && candidateTicker && identityTicker === candidateTicker) {
    const exchangeMatch = identityExchange && candidateExchange && identityExchange === candidateExchange;
    const currencyMatch = identityCurrency && candidateCurrency && identityCurrency === candidateCurrency;
    if (exchangeMatch && currencyMatch) return { confidence: 0.95 };
    if (exchangeMatch) return { confidence: 0.85 };
    if (currencyMatch) return { confidence: 0.7 };
    return { confidence: 0.7 };
  }

  if (identityName && candidateName && identityName === candidateName) return { confidence: 0.5 };

  return { confidence: 0 };
}

function normalizeAssetName(value?: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function normalizeName(value?: string): string | undefined {
  return normalizeWhitespace(value);
}

function normalizeReadableName(value?: string): string | undefined {
  return normalizeWhitespace(value);
}

function normalizeUpper(value?: string): string | undefined {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.toUpperCase() : undefined;
}

function normalizeWhitespace(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s+/g, ' ');
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
