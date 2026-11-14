import { normalizeMerchantForMatch } from '@service/transaction/merchant-normalization';
import { roundMoney } from '@utils/money';

/**
 * Likely duplicates on import: a file row that no id matched may still be a transaction the
 * account already holds, synced from the bank a day earlier or later, or written with another
 * description. This module is the decision only, and pure.
 *
 * A row's candidates are the account's transactions with the same signed amount, to the cent, in
 * the same currency, dated at most {@link LIKELY_DUPLICATE_WINDOW_DAYS} calendar days before or
 * after it (inclusive). Then:
 *
 *   - one candidate: the row is a likely duplicate of it;
 *   - several: when exactly one of them names the same merchant (normalised names sharing at
 *     least half their words, {@link merchantSimilarity}), that one; otherwise the row is
 *     ambiguous: a likely duplicate of no one transaction, and the review says so;
 *   - none: the row is new.
 *
 * One transaction is claimed by at most one row: two identical coffees in the file against one in
 * the account leave one row new. Transactions already claimed (by an exact match) are left out.
 * Claims are settled in rounds, in a fixed order: each round, the rows left with exactly one
 * candidate claim it, and when two rows want the same one, the closer match wins (the merchant
 * name first, then the days apart, then the earlier row in the file). A row whose candidates
 * have all been claimed is new; rows still left with several when no row has exactly one are
 * ambiguous. Nothing here drops a row: the review shows the match and the person decides.
 */

export const LIKELY_DUPLICATE_WINDOW_DAYS = 3;
/** The share of words two merchant names must have in common to name the same merchant. */
export const MERCHANT_SIMILARITY_THRESHOLD = 0.5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Words a bank adds to a card or transfer line that say nothing about the merchant
 * (`COMPRA 4412 CONTINENTE`, `CARD PAYMENT TO NETFLIX`), in the languages the banks write in.
 */
const GENERIC_WORDS = new Set([
  'card', 'compra', 'compras', 'credit', 'credito', 'deb', 'debit', 'debito', 'direct', 'mb', 'pagamento', 'pago', 'payment', 'pos', 'purchase', 'tpa', 'transf', 'transfer', 'transferencia', 'trf', 'visa', 'way',
]);

export interface LikelyDuplicateCandidate {
  /** Signed amounts the transaction counts as: what the bank charged and, if edited, what the person set. */
  amounts: number[];
  currency: null | string;
  date: Date | null;
  /** The transaction's merchant, else its description. */
  name?: null | string;
  transactionKey: number;
}

export type LikelyDuplicateOutcome =
  | { candidates: number[]; status: 'ambiguous' }
  | { status: 'match'; transactionKey: number }
  | { status: 'none' };

export interface LikelyDuplicateRow {
  /** Signed, in `currency`. */
  amount: number;
  /** ISO 4217. */
  currency: string;
  date: Date | string;
  /** The row's merchant, else its description. */
  name?: null | string;
  /** The row's line in the file: the order claims are settled in, and its key in the result. */
  sourceRow: number;
}

/** The words of a name that tell merchants apart: normalised, without codes, numbers and bank filler. */
function merchantWords(name: null | string | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(normalizeMerchantForMatch(name).split(' ').filter((word) => word.length >= 2 && !/^\d+$/.test(word) && !GENERIC_WORDS.has(word)));
}

/**
 * How alike two merchant names are, from 0 to 1: the words they share over the words of the
 * shorter one, so `Continente` and `COMPRA CONTINENTE MATOSINHOS` are alike. Null when either
 * names nothing to compare.
 */
export function merchantSimilarity(a: null | string | undefined, b: null | string | undefined): null | number {
  const left = merchantWords(a);
  const right = merchantWords(b);
  if (left.size === 0 || right.size === 0) return null;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** The calendar day (UTC) of a date, as a day number. */
function dayOf(date: Date | string): number {
  return Math.floor(new Date(date).getTime() / MS_PER_DAY);
}

const cents = (amount: number) => Math.round(roundMoney(amount, 2) * 100);

interface Pairing {
  days: number;
  similarity: null | number;
  transactionKey: number;
}

/** Negative when `a` is the closer match: the merchant name first, then the days apart; 0 when neither is. */
function closer(a: Pairing, b: Pairing): number {
  const bySimilarity = (b.similarity ?? 0) - (a.similarity ?? 0);
  return bySimilarity !== 0 ? bySimilarity : a.days - b.days;
}

/** Each row's outcome, by its `sourceRow`. `claimed` are transactions already taken (by exact matches). */
export function matchLikelyDuplicates(rows: readonly LikelyDuplicateRow[], candidates: readonly LikelyDuplicateCandidate[], options: { claimed?: Iterable<number>; windowDays?: number } = {}): Map<number, LikelyDuplicateOutcome> {
  const windowDays = options.windowDays ?? LIKELY_DUPLICATE_WINDOW_DAYS;
  const claimed = new Set(options.claimed ?? []);
  const outcome = new Map<number, LikelyDuplicateOutcome>();
  const pairings = new Map<number, Pairing[]>();

  const ordered = [...rows].sort((a, b) => a.sourceRow - b.sourceRow);
  for (const row of ordered) {
    const rowCents = cents(row.amount);
    const rowDay = dayOf(row.date);
    const found: Pairing[] = [];
    for (const candidate of candidates) {
      if (candidate.date === null || candidate.currency !== row.currency) continue;
      if (!candidate.amounts.some((amount) => cents(amount) === rowCents)) continue;
      const days = Math.abs(dayOf(candidate.date) - rowDay);
      if (days > windowDays) continue;
      found.push({ days, similarity: merchantSimilarity(row.name, candidate.name), transactionKey: candidate.transactionKey });
    }
    found.sort((a, b) => closer(a, b) || a.transactionKey - b.transactionKey);
    if (found.length === 0) outcome.set(row.sourceRow, { status: 'none' });
    else pairings.set(row.sourceRow, found);
  }

  /** The one candidate a row can claim now, the several it cannot choose between, or none left. */
  const choice = (sourceRow: number): Pairing | Pairing[] => {
    const open = (pairings.get(sourceRow) ?? []).filter((pairing) => !claimed.has(pairing.transactionKey));
    const named = open.filter((pairing) => (pairing.similarity ?? 0) >= MERCHANT_SIMILARITY_THRESHOLD);
    const [only] = open.length === 1 ? open : named.length === 1 ? named : [];
    return only ?? open;
  };

  let pending = ordered.map((row) => row.sourceRow).filter((sourceRow) => pairings.has(sourceRow));
  while (pending.length > 0) {
    const wanted = new Map<number, { pairing: Pairing; sourceRow: number }>();
    const waiting: number[] = [];
    for (const sourceRow of pending) {
      const chosen = choice(sourceRow);
      if (Array.isArray(chosen)) {
        if (chosen.length === 0) outcome.set(sourceRow, { status: 'none' });
        else waiting.push(sourceRow);
        continue;
      }
      // Rows are in file order, so on a tie the earlier row keeps its claim.
      const rival = wanted.get(chosen.transactionKey);
      if (!rival || closer(chosen, rival.pairing) < 0) wanted.set(chosen.transactionKey, { pairing: chosen, sourceRow });
    }
    if (wanted.size === 0) {
      for (const sourceRow of waiting) outcome.set(sourceRow, { candidates: (choice(sourceRow) as Pairing[]).map((pairing) => pairing.transactionKey), status: 'ambiguous' });
      break;
    }
    for (const [transactionKey, { sourceRow }] of wanted) {
      claimed.add(transactionKey);
      outcome.set(sourceRow, { status: 'match', transactionKey });
    }
    pending = pending.filter((sourceRow) => !outcome.has(sourceRow));
  }
  return outcome;
}
