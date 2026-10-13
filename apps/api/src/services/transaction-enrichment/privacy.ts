const TRANSACTION_MAX_LENGTH = 80;
const MERCHANT_MAX_LENGTH = 80;
const CATEGORY_MAX_LENGTH = 50;
const MIN_TEXT_LENGTH = 2;

const SAFE_DISPLAY = /[^\p{L}\p{N}\p{Zs}.'’&+\-()@,_]/gu;
const IBAN_COMPACT = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i;
const IBAN_SPACED = /\b[A-Z]{2}(?:\s*[A-Z0-9]){13,34}\b/i;

export function hasSensitiveBankingPattern(value: string): boolean {
  return isSensitiveBankingPattern(value.normalize('NFKC'), value.normalize('NFKC'));
}

export function sanitizeCategoryLabel(value?: null | string): string | undefined {
  return sanitize(value, CATEGORY_MAX_LENGTH);
}

export function sanitizeMerchantSuggestion(value?: null | string): string | undefined {
  return sanitize(value, MERCHANT_MAX_LENGTH);
}

export function sanitizeTransactionEnrichmentText(value?: null | string): string | undefined {
  return sanitize(value, TRANSACTION_MAX_LENGTH);
}

function isSensitiveBankingPattern(raw: string, value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  const loweredRaw = raw.toLowerCase();
  const lowered = value.toLowerCase();
  const hasLongDigits = /\d(?:[\s.-]?\d){5,}/.test(value);
  const hasPhone = /\+?\d(?:[\d\s().-]*\d){6,}/.test(value);
  const hasUpperDigitRef = /\b(?=.*[A-Z])(?=.*\d)[A-Z0-9]{16,}\b/.test(compact);
  const slashOrPipeOrSemicolonCount = (value.match(/[|;]/g)?.length ?? 0) + (value.includes('/') ? 1 : 0);
  const hasSlashPipeSemicolonBlob = slashOrPipeOrSemicolonCount >= 2;
  const hasAccountish = lowered.includes('conta') || lowered.includes('cartão') || lowered.includes('cartao') || lowered.includes('acc ') || lowered.includes('acct ') || lowered.includes('account ') || lowered.includes('card ') || lowered.includes('ref:') || lowered.includes('ref ') || lowered.includes('reference ') || lowered.includes('mov ') || lowered.includes('movimento ') || lowered.includes('doc ') || lowered.includes('documento ');
  const hasGeneric = lowered.includes('transfer') || lowered.includes('transferência') || lowered.includes('transferencia') || lowered.includes('mb way') || lowered.includes('sepa') || lowered.includes('trf') || lowered.includes('balance') || lowered.includes('saldo') || lowered.includes('statement') || lowered.includes('extrato');
  return compact.length < MIN_TEXT_LENGTH || compact.length > 255 || IBAN_COMPACT.test(value) || IBAN_SPACED.test(value) || hasLongDigits || hasPhone || hasUpperDigitRef || hasSlashPipeSemicolonBlob || hasAccountish || hasGeneric || loweredRaw.includes('@') || loweredRaw.includes('http://') || loweredRaw.includes('https://') || loweredRaw.includes('www.');
}

function sanitize(value: null | string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.normalize('NFKC');
  if ((raw.match(/[|;]/g)?.length ?? 0) >= 2 || (raw.includes('/') && (raw.match(/[|;]/g)?.length ?? 0) >= 1)) return undefined;
  const normalized = stripControls(raw).replace(SAFE_DISPLAY, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length < MIN_TEXT_LENGTH || normalized.length > maxLength) return undefined;
  return isSensitiveBankingPattern(raw, normalized) ? undefined : normalized;
}

function stripControls(value: string): string {
  let output = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    output += code < 32 || code === 127 ? ' ' : char;
  }
  return output;
}
