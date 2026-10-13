import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildPortfolioImportAssetReviewDecisionsPayload,
  getPendingAssetReviewGroupIds,
  hasUserDecisionForAssetReviewGroup,
} from "./import-session-asset-review";

const groups = [
  { id: 1, status: "ambiguous", identity: {}, candidates: [{ id: 11 }] },
  { id: 2, status: "provider_error", identity: {}, candidates: [{ id: 22 }] },
  { id: 3, status: "matched", identity: {}, candidates: [{ id: 33 }] },
  { id: 4, status: "skipped", identity: { brokerTicker: "EUR.USD" } },
] as const;

test("builds payload only from explicit local decisions", () => {
  assert.deepEqual(
    buildPortfolioImportAssetReviewDecisionsPayload(groups as never, {
      1: { action: "use_candidate", candidateId: 11 },
      2: { action: "use_external_symbol", symbol: "IWDA.AS" },
      3: { action: "use_candidate", candidateId: 33 },
      4: { action: "use_external_symbol", symbol: "EURUSD=X" },
    }),
    [
      { action: "use_candidate", groupId: 1, candidateId: 11 },
      { action: "use_external_symbol", groupId: 2, symbol: "IWDA.AS" },
      { action: "use_candidate", groupId: 3, candidateId: 33 },
    ],
  );
});

test("only flags unresolved blocking groups as pending", () => {
  assert.deepEqual(getPendingAssetReviewGroupIds(groups as never, { 1: { action: "use_candidate", candidateId: 11 } }), [2]);
});

test("excludes automatically skipped unsupported groups from review decisions", () => {
  assert.deepEqual(
    buildPortfolioImportAssetReviewDecisionsPayload(groups as never, {
      4: { action: "use_external_symbol", symbol: "EURUSD=X" },
    }),
    [],
  );
  assert.deepEqual(getPendingAssetReviewGroupIds(groups as never, {}), [1, 2]);
});

test("recognizes valid explicit decisions only", () => {
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "use_candidate", candidateId: 11 }), true);
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "use_candidate", candidateId: 99 }), false);
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "use_external_symbol", symbol: "IWDA.AS" }), true);
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "use_external_symbol", symbol: "   " }), false);
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "skip_group", skipReason: "" }), false);
  assert.equal(hasUserDecisionForAssetReviewGroup(groups[0] as never, { action: "skip_group", skipReason: "duplicate" }), true);
});
