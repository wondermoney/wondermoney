import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

/**
 * When a rule is suggested after manual recategorization (`rule-suggestion.service.ts`). The
 * product decision on both numbers is open: change them here, and only here.
 */
export const RULE_SUGGESTION_POLICY = {
  /** How many of a member's own manual category changes make a pattern. */
  minMatches: 3,
  /** How far back those changes may be, in days, counted from now (the edge day counts). */
  windowDays: 90,
} as const;

/** At most this many leading words of a description make its prefix. */
export const MAX_PREFIX_TOKENS = 3;
/** A prefix needs at least this many letters, so a stray "a" or "x1" never becomes a rule. */
const MIN_PREFIX_LETTERS = 3;

/**
 * Words banks put before the part that names the payee: "COMPRA 1192 CONTINENTE", "TRF MB WAY
 * ...", "PAG. SERVICOS ...". Followed by a reference (`COMPRA 1192`) such a word is a header
 * and is skipped; a prefix made only of them ("compra", "trf. mb") says nothing about who was
 * paid, so it is never suggested.
 */
const GENERIC_WORDS = new Set([
  'card', 'cartao', 'compra', 'compras', 'credit', 'credito', 'dd', 'debit', 'debito', 'levantamento', 'mb', 'pag', 'pag.', 'pagamento', 'payment', 'pos', 'purchase', 'sepa', 'transf', 'transf.', 'transfer', 'transferencia', 'trf', 'trf.',
]);

/** Words that announce a reference rather than name anyone ("REF 123", "N. 1914..."). */
const REFERENCE_MARKERS = new Set(['#', 'n.', 'n.o', 'nº', 'no.', 'ref', 'ref.', 'ref:', 'reference']);

/** A token that is a reference, not a name: anything with a digit (card numbers, dates, amounts, phones, IBANs), a marker, or bare punctuation. */
function isReference(token: string): boolean {
  return /\d/.test(token) || REFERENCE_MARKERS.has(token) || !/\p{L}/u.test(token);
}

const letterCount = (value: string) => value.match(/\p{L}/gu)?.length ?? 0;

/** A description prefix a rule can match: `description <operator> <value>`, on the cleaned description. */
export interface DescriptionPrefix {
  /** The normalized prefix (lower case, no accents, single spaces): the grouping key. */
  key: string;
  /** `starts_with` when the prefix opens the description, `contains` when a header came before it. */
  operator: 'contains' | 'starts_with';
  /** The words as the description spells them, for the rule's condition and name. */
  value: string;
}

interface DescriptionRun {
  anchored: boolean;
  /** The words as written. */
  display: string[];
  /** The same words normalized as the rules engine compares text (`normalizeMerchantName`). */
  tokens: string[];
}

/**
 * The words that name the payee at the start of a description: a leading header and references
 * skipped, then words up to the first reference, at most {@link MAX_PREFIX_TOKENS}.
 *
 * Normalization is the rules engine's own (`normalizeMerchantName`: case, accents, spaces), and
 * the words stay contiguous, so a rule on the prefix matches the description it came from.
 */
function acceptable(tokens: string[]): boolean {
  return letterCount(tokens.join('')) >= MIN_PREFIX_LETTERS && tokens.some((token) => !GENERIC_WORDS.has(token));
}

function descriptionRun(description: null | string | undefined): DescriptionRun | null {
  const display = (description ?? '').trim().split(/\s+/).filter(Boolean);
  // Accent stripping keeps word boundaries, so the two lists stay aligned.
  const tokens = display.map((word) => normalizeMerchantName(word));
  const referenceAt = (index: number) => {
    const token = tokens[index];
    return token !== undefined && isReference(token);
  };
  // "COMPRA 1192 ...": a generic word straight before a reference is the bank's header.
  let start = GENERIC_WORDS.has(tokens[0] ?? '') && referenceAt(1) ? 1 : 0;
  while (referenceAt(start)) start += 1;
  if (start >= tokens.length) return null;
  let end = start;
  while (end < tokens.length && end - start < MAX_PREFIX_TOKENS && !referenceAt(end)) end += 1;
  if (end === start) return null;
  return { anchored: start === 0, display: display.slice(start, end), tokens: tokens.slice(start, end) };
}

/**
 * Every prefix of the description worth a rule, longest first: "TRF MB WAY PARA JOANA 1234"
 * gives "TRF MB WAY" (and not "TRF MB", which only says it was a transfer).
 */
export function descriptionPrefixCandidates(description: null | string | undefined): DescriptionPrefix[] {
  const run = descriptionRun(description);
  if (!run) return [];
  const candidates: DescriptionPrefix[] = [];
  for (let length = run.tokens.length; length > 0; length -= 1) {
    const tokens = run.tokens.slice(0, length);
    if (!acceptable(tokens)) continue;
    candidates.push({ key: tokens.join(' '), operator: run.anchored ? 'starts_with' : 'contains', value: run.display.slice(0, length).join(' ') });
  }
  return candidates;
}

/**
 * The cleaned description prefix: references and numbers stripped, a bank's header skipped, at
 * most {@link MAX_PREFIX_TOKENS} words. Null when nothing in the description names anyone.
 *
 * - `TRF MB WAY 912345678 JOAO` → `TRF MB WAY`, `starts_with`
 * - `COMPRA 1192 CONTINENTE SANTA MARINH` → `CONTINENTE SANTA MARINH`, `contains`
 * - `LIDL 1234 LISBOA` → `LIDL`, `starts_with`
 */
export function cleanDescriptionPrefix(description: null | string | undefined): DescriptionPrefix | null {
  return descriptionPrefixCandidates(description)[0] ?? null;
}
