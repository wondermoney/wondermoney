import assert from "node:assert/strict";

import { test } from "vitest";

import { buildDependentsSchema } from "@/app/[locale]/(no-layout)/budgets/wizard/store";

test("dependents equal to household size is valid, not blocked", () => {
  const schema = buildDependentsSchema({ householdSize: 2 }, "too many");

  // A single-parent household of 2 with 2 dependents.
  // This is also the slider's own max, so it must never be rejected.
  const atMax = schema.safeParse({ dependentsNum: 2 });
  assert.equal(atMax.success, true);

  const belowMax = schema.safeParse({ dependentsNum: 1 });
  assert.equal(belowMax.success, true);
});

test("dependents above household size is still rejected with a visible message", () => {
  const schema = buildDependentsSchema({ householdSize: 2 }, "too many");

  const aboveMax = schema.safeParse({ dependentsNum: 3 });
  assert.equal(aboveMax.success, false);
  if (!aboveMax.success) {
    assert.equal(aboveMax.error.issues[0]?.path[0], "dependentsNum");
    assert.equal(aboveMax.error.issues[0]?.message, "too many");
  }
});

test("dependents validation is a no-op before household data exists", () => {
  const schema = buildDependentsSchema(undefined, "too many");

  const result = schema.safeParse({ dependentsNum: 999 });
  assert.equal(result.success, true);
});
