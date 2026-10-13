import assert from "node:assert/strict";

import { test } from "vitest";

import { getCategorizationReviewHint } from "./categorization-confidence-copy";

const tx = (categorizationConfidence: null | string | undefined) =>
  ({ categorizationConfidence }) as never;

test("getCategorizationReviewHint maps low to the unclear warning hint", () => {
  assert.deepEqual(getCategorizationReviewHint(tx("low")), {
    messageKey: "review-hint-unclear",
    tone: "warning",
  });
});

test("getCategorizationReviewHint maps medium to the muted suggested hint", () => {
  assert.deepEqual(getCategorizationReviewHint(tx("medium")), {
    messageKey: "review-hint-suggested",
    tone: "muted",
  });
});

test("getCategorizationReviewHint maps none to the muted new-merchant hint", () => {
  assert.deepEqual(getCategorizationReviewHint(tx("none")), {
    messageKey: "review-hint-new-merchant",
    tone: "muted",
  });
});

test("getCategorizationReviewHint returns null for high and missing confidence", () => {
  assert.equal(getCategorizationReviewHint(tx("high")), null);
  assert.equal(getCategorizationReviewHint(tx(null)), null);
  assert.equal(getCategorizationReviewHint(tx(undefined)), null);
});
