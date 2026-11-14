/**
 * Merchant-name normalisation.
 *
 * `normalizeMerchantName` is the storage identity: case, accents and whitespace only. It is what
 * `TransactionMerchant.normalizedName` holds, so existing rows keep their identity.
 *
 * `normalizeMerchantForMatch` is the comparison key used when deciding whether two rows name the
 * same merchant. Card descriptors carry noise the display name does not: processor prefixes
 * (`SQ *`, `TST*`, `PAYPAL *`), punctuation, marketplace abbreviations (`AMZN Mktp` → `Amazon`)
 * and a trailing location (`... LISBOA`, `... US*2H4`). It is deliberately conservative: only a
 * curated set of location words and code-shaped tokens is removed, so an unknown city simply
 * fails to match instead of merging two different merchants.
 */

const PROCESSOR_PREFIX = /^(?:(?:sq|tst|pp|sp|pos|wpy)\s*\*\s*|(?:adyen|clover|izettle|paypal|stripe|sumup|worldpay|zettle)\s*(?:\*\s*)?)+(?=\S)/;

const TOKEN_ALIASES: Record<string, string> = { amzn: 'amazon' };
const DROPPED_TOKENS = new Set(['marketplace', 'mkpl', 'mktp']);

const LOCATION_SUFFIX_CODES = new Set([
  'ae', 'au', 'br', 'ca', 'ch', 'de', 'dk', 'es', 'fi', 'fr', 'gb', 'hk', 'ie', 'jp', 'mx', 'nl', 'nz', 'pl', 'pt', 'se', 'sg', 'uk', 'us', 'usa', 'za',
]);

const LOCATION_SUFFIX_NAMES = new Set([
  'amsterdam', 'athens', 'austin', 'barcelona', 'beijing', 'belgium', 'berlin', 'boston', 'braga', 'brazil', 'brussels', 'budapest', 'canada', 'chicago', 'coimbra', 'copenhagen', 'denver', 'dubai', 'dublin', 'faro', 'finland', 'france', 'geneva', 'germany', 'helsinki', 'hong kong', 'istanbul', 'italy', 'lisboa', 'lisbon', 'london', 'los angeles', 'lyon', 'madrid', 'manchester', 'melbourne', 'mexico', 'mexico city', 'miami', 'milan', 'mumbai', 'munich', 'netherlands', 'new york', 'new zealand', 'norway', 'nyc', 'oslo', 'paris', 'poland', 'porto', 'portugal', 'prague', 'rome', 'san francisco', 'sao paulo', 'seattle', 'seville', 'singapore', 'spain', 'stockholm', 'sydney', 'tokyo', 'toronto', 'united kingdom', 'united states', 'vancouver', 'vienna', 'warsaw', 'zurich',
]);

export function normalizeMerchantForMatch(name: string): string {
  const withoutProcessor = normalizeMerchantName(name).replace(PROCESSOR_PREFIX, '');
  const withoutPunctuation = withoutProcessor
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliased = withoutPunctuation
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token.length > 0 && !DROPPED_TOKENS.has(token))
    .join(' ');

  return stripTrailingLocation(aliased);
}

export function normalizeMerchantName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isLocationCode(token: string): boolean {
  // A store/transaction/zip code: digits, or an alphanumeric code starting with a digit (`2h4`).
  if (/^\d[a-z0-9]{2,}$/.test(token)) return true;
  return /^[a-z]{2}$/.test(token) && LOCATION_SUFFIX_CODES.has(token);
}

function stripTrailingLocation(value: string): string {
  const tokens = value.split(' ');
  let stripped = true;

  while (stripped && tokens.length > 1) {
    stripped = false;
    const last = tokens[tokens.length - 1];
    if (!last) break;

    if (isLocationCode(last)) {
      tokens.pop();
      stripped = true;
      continue;
    }

    if (tokens.length > 2) {
      const previous = tokens[tokens.length - 2];
      if (previous && LOCATION_SUFFIX_NAMES.has(`${previous} ${last}`)) {
        tokens.pop();
        tokens.pop();
        stripped = true;
        continue;
      }
    }

    if (LOCATION_SUFFIX_NAMES.has(last)) {
      tokens.pop();
      stripped = true;
    }
  }

  return tokens.join(' ');
}
