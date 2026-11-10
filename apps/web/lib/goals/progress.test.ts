import assert from "node:assert/strict";

import { test } from "vitest";

import { goalProgress } from "./progress";

test("a goal's progress is the API's own figure, on every surface", () => {
  // Spending from a goal lowers what is available but not what was funded;
  // the list and the detail page must read the same number either way.
  assert.equal(
    goalProgress({
      targetAmount: 1800,
      summary: { progressPercentage: 25, availableAmount: 300 },
    }),
    25,
  );
});

test("without an API figure, progress is what is available against the target", () => {
  assert.equal(
    goalProgress({ targetAmount: 6000, summary: { availableAmount: 1200 } }),
    20,
  );
});

test("progress is absent when it cannot be known, and capped at 100", () => {
  assert.equal(
    goalProgress({ targetAmount: 0, summary: { availableAmount: 10 } }),
    null,
  );
  assert.equal(goalProgress({ targetAmount: 100 }), null);
  assert.equal(
    goalProgress({ targetAmount: 100, summary: { progressPercentage: 140 } }),
    100,
  );
  assert.equal(
    goalProgress({ targetAmount: 100, summary: { progressPercentage: -5 } }),
    0,
  );
});
