import assert from "node:assert/strict";

import { test } from "vitest";

import { getPortfolioImportReviewReasonMessageKey } from "./import-session-resolution-reasons";

test("maps provider_error to the provider error message key", () => {
  assert.equal(
    getPortfolioImportReviewReasonMessageKey("provider_error"),
    "portfolio-import-review-reason-provider-error",
  );
});

test("maps user_selected_external_symbol to the external symbol message key", () => {
  assert.equal(
    getPortfolioImportReviewReasonMessageKey("user_selected_external_symbol"),
    "portfolio-import-review-reason-user-selected-external-symbol",
  );
});

test("returns undefined for unknown or empty review reasons", () => {
  assert.equal(getPortfolioImportReviewReasonMessageKey("unknown_code"), undefined);
  assert.equal(getPortfolioImportReviewReasonMessageKey("constructor"), undefined);
  assert.equal(getPortfolioImportReviewReasonMessageKey("toString"), undefined);
  assert.equal(getPortfolioImportReviewReasonMessageKey(""), undefined);
  assert.equal(getPortfolioImportReviewReasonMessageKey(undefined), undefined);
});
