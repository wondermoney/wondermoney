const portfolioImportReviewReasonMessageKeys = {
  provider_error: "portfolio-import-review-reason-provider-error",
  provider_high_confidence_needs_review:
    "portfolio-import-review-reason-provider-high-confidence-needs-review",
  user_skipped_group: "portfolio-import-review-reason-user-skipped-group",
  user_selected_candidate:
    "portfolio-import-review-reason-user-selected-candidate",
  user_selected_external_symbol:
    "portfolio-import-review-reason-user-selected-external-symbol",
  user_selected_existing_asset:
    "portfolio-import-review-reason-user-selected-existing-asset",
} as const;

export function getPortfolioImportReviewReasonMessageKey(reason?: string) {
  const normalizedReason = reason?.trim();
  if (!normalizedReason) return undefined;

  if (!Object.hasOwn(portfolioImportReviewReasonMessageKeys, normalizedReason)) {
    return undefined;
  }

  return portfolioImportReviewReasonMessageKeys[
    normalizedReason as keyof typeof portfolioImportReviewReasonMessageKeys
  ];
}
