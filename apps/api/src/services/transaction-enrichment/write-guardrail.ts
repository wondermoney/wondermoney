/**
 * The pure half of write mode's guardrails: which model suggestions may become a category.
 *
 * The enrichment worker applies these before it writes a suggestion, and the golden-set evals
 * (`src/evals`) apply the same rules, so an eval's "assigned" is what production would write.
 */

/**
 * The system category the enrichment pipeline is never allowed to write. It is the model's most
 * common suggestion by far, and writing it is worse than writing nothing: it carries no
 * information *and* it marks the transaction categorised, so it stops being an enrichment
 * candidate and drops off every needs-attention surface. Matched by name because the key is
 * seed-order dependent (see CategorySeeder).
 */
const UNINFORMATIVE_CATEGORY_NAME = 'OTHER';

/** True when the suggestion names a category with at least the write threshold's confidence. */
export function clearsWriteThreshold(
  result: Readonly<{ categorySuggestionKey: null | number; confidence: number }>,
  threshold: number,
): result is Readonly<{ categorySuggestionKey: number; confidence: number }> {
  return result.categorySuggestionKey !== null && result.confidence >= threshold;
}

/** True for the system `OTHER` category, which write mode never applies at any confidence. */
export function isUninformativeCategory(category: Readonly<{ isSystemCategory: boolean; name: string }>): boolean {
  return category.isSystemCategory && category.name === UNINFORMATIVE_CATEGORY_NAME;
}
