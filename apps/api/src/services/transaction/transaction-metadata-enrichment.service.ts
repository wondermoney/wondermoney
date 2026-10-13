const DB_SAFE_LENGTH = 255;

export interface TransactionMetadataEnrichmentInput {
  creditDebitIndicator?: string;
  creditorName?: string;
  debtorName?: string;
  descriptionDirty?: string;
  remittanceInformationStructured?: string;
  remittanceInformationUnstructured?: string;
}

export interface TransactionMetadataEnrichmentResult {
  descriptionDirty?: string;
  rules: string[];
}

const GENERIC_LABELS = [/^transfer$/i, /^transf(?:er|\.)/i, /^payment$/i, /^pymt$/i, /^debit$/i, /^credit$/i, /^sepa$/i, /^dd\b/i, /^trf\b/i, /^compra\b/i, /^pag\b/i, /^mb way$/i];
const IBAN_COMPACT = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i;
const IBAN_SPACED = /\b[A-Z]{2}\s*\d{2}(?:\s*[A-Z0-9]){11,30}\b/i;
const LONG_REFERENCE_COMPACT = /\b\d{12,}\b/;
const LONG_REFERENCE_SPACED = /\b\d(?:\s*\d){11,}\b/;

export function enrichTransactionMetadata(input: TransactionMetadataEnrichmentInput): TransactionMetadataEnrichmentResult {
  const rules: string[] = [];
  const descriptionDirty = buildDescriptionDirty(input, rules);
  return { descriptionDirty, rules };
}

export function isTransactionMetadataEnrichmentEnabled(value = process.env['TRANSACTION_METADATA_ENRICHMENT_ENABLED']): boolean {
  if (value == null || value === '') return true;
  return !/^(?:0|false|no|off)$/i.test(value.trim());
}

function buildDescriptionDirty(input: TransactionMetadataEnrichmentInput, rules: string[]): string | undefined {
  const candidates = [input.descriptionDirty, input.remittanceInformationUnstructured, input.remittanceInformationStructured, pickCounterpartyName(input)];
  for (const candidate of candidates) {
    const sanitized = sanitizeText(candidate);
    if (!sanitized) continue;
    if (isUnsafeReference(sanitized)) {
      rules.push('descriptionDirty:rejected');
      continue;
    }
    if (isGenericLabel(sanitized)) {
      rules.push('descriptionDirty:generic-rejected');
      continue;
    }
    rules.push(candidate === input.descriptionDirty ? 'descriptionDirty:preferred' : 'descriptionDirty:fallback');
    return sanitized;
  }
  return undefined;
}

function isGenericLabel(value: string): boolean {
  return GENERIC_LABELS.some((pattern) => pattern.test(value));
}

function isUnsafeReference(value: string): boolean {
  return IBAN_COMPACT.test(value) || IBAN_SPACED.test(value) || LONG_REFERENCE_COMPACT.test(value) || LONG_REFERENCE_SPACED.test(value) || /^\d[\d\s.,/-]*$/.test(value);
}

function pickCounterpartyName(input: TransactionMetadataEnrichmentInput): string | undefined {
  const isCredit = (input.creditDebitIndicator ?? '').toLowerCase() === 'credit';
  const primary = sanitizeText(isCredit ? input.debtorName : input.creditorName);
  const fallback = sanitizeText(input.creditorName ?? input.debtorName);
  return [primary, fallback].find((value): value is string => Boolean(value) && value !== undefined && !isUnsafeReference(value) && !isGenericLabel(value));
}

function sanitizeText(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.normalize('NFKC').split('').map((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : char;
  }).join('').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > DB_SAFE_LENGTH ? normalized.slice(0, DB_SAFE_LENGTH) : normalized;
}
