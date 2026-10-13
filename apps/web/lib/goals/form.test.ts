import assert from "node:assert/strict";

import { test } from "vitest";

import { parseGoalMoney } from "./form";

test("parses localized goal money inputs", () => {
  // Given
  const inputs = ["1,234.56", "1.234,56", "1234,56"] as const;

  // When
  const values = inputs.map(parseGoalMoney);

  // Then
  assert.deepEqual(values, [1234.56, 1234.56, 1234.56]);
});

test("rejects empty and ambiguous goal money inputs", () => {
  // Given / When / Then
  assert.ok(Number.isNaN(parseGoalMoney("")));
  assert.ok(Number.isNaN(parseGoalMoney("1.2345")));
});
