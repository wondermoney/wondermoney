import { CategorizationConfidence, type Transaction } from '@entity/Transaction';
import type { DeterministicCategorizationReason } from '@service/transaction/transaction-deterministic-categorization.service';

export type CategorizationReason = 'ai_suggested' | 'user_edit' | DeterministicCategorizationReason;

/** The subset of a Transaction the confidence writers touch — keeps the helpers unit-testable with a plain object. */
export type CategorizableTransaction = Pick<Transaction, 'categorizationConfidence' | 'categorizationReason' | 'reviewed'>;

/**
 * RAD-342.2 — the single source of truth mapping a categorization reason to a confidence tier.
 * Returns null for "no-op" reasons (the categorizer didn't actually evaluate a signal), meaning
 * the caller should leave the transaction's existing confidence untouched.
 */
export function categorizationConfidenceFor(reason: CategorizationReason): CategorizationConfidence | null {
  switch (reason) {
    case 'ai_suggested':
      // An AI-applied category the user should confirm; medium tier, stays in the review queue.
      return CategorizationConfidence.MEDIUM;
    case 'category_invalid':
    case 'merchant_ambiguous':
    case 'stats_tie':
      return CategorizationConfidence.LOW;
    case 'merchant_no_mapping':
    case 'unsafe_text':
      return CategorizationConfidence.NONE;
    case 'stats_default':
    case 'stats_top_count':
      return CategorizationConfidence.MEDIUM;
    case 'user_edit':
    case 'user_mapping':
      return CategorizationConfidence.HIGH;
    default:
      // disabled / already_categorized / duplicate / duplicate-assignment — no signal was evaluated.
      return null;
  }
}

/**
 * Automated-path writer (sync / CSV / backfill): stamp the confidence tier + reason, and — only for
 * `high` — auto-clear the transaction from the review queue.
 */
export function applyCategorizationOutcome(transaction: CategorizableTransaction, reason: DeterministicCategorizationReason): void {
  const tier = categorizationConfidenceFor(reason);
  if (tier === null) return;
  transaction.categorizationConfidence = tier;
  transaction.categorizationReason = reason;
  if (tier === CategorizationConfidence.HIGH) transaction.reviewed = true;
}

/**
 * User-path writer: the human explicitly chose the category, so confidence is `high` with reason
 * `user_edit`. Does NOT touch `reviewed` — the user-categorization paths set that themselves.
 */
export function markUserCategorized(transaction: CategorizableTransaction): void {
  transaction.categorizationConfidence = CategorizationConfidence.HIGH;
  transaction.categorizationReason = 'user_edit';
}
