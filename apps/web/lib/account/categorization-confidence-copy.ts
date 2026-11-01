import type { Transaction } from "@/lib/api/account/useTransactions";

export interface ReviewHint {
  messageKey: string;
  tone: "muted" | "warning";
}

/**
 * Map a transaction's categorization confidence to a review-inbox "why" hint.
 * Returns null when there's nothing useful to say (high is auto-cleared from review; missing
 * confidence = pre-G3a / not evaluated). The component translates `messageKey`.
 */
export function getCategorizationReviewHint(
  transaction: Pick<Transaction, "categorizationConfidence">,
): null | ReviewHint {
  switch (transaction.categorizationConfidence) {
    case "low":
      return { messageKey: "review-hint-unclear", tone: "warning" };
    case "medium":
      return { messageKey: "review-hint-suggested", tone: "muted" };
    case "none":
      return { messageKey: "review-hint-new-merchant", tone: "muted" };
    default:
      return null;
  }
}
