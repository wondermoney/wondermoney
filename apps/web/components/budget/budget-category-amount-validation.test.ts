import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

test("budget category edit sheet validates budget amount before PATCH", () => {
  const source = readSource("components/budget/BudgetCategoryEditSheet.tsx");

  assert.match(
    source,
    /import \{ parseLocaleNumber, zLocaleNumber \} from "@\/lib\/utils\/number";/,
    "Edit sheet must use the locale-aware parser for both validation and live amount previews",
  );
  assert.match(
    source,
    /budgeted:\s*zLocaleNumber\.pipe\(\s*z\.number\(\)\.positive\(t\("budget-amount-positive"\)\)/s,
    "Edit sheet must reject blank or zero budget amounts with translated inline validation before calling the API",
  );
  assert.match(
    source,
    /const budgetedPreviewValue =\s*typeof field\.value === "number"\s*\? field\.value\s*:\s*parseLocaleNumber\(field\.value\);/s,
    "Edit sheet calculated previews must not use Number(field.value), which displays NaN for comma decimals",
  );
});

test("inline budget editor rejects invalid amount commits before PATCH", () => {
  const source = readSource("components/budget/BudgetTableNew.tsx");

  assert.match(
    source,
    /import \{ parseLocaleNumber \} from "@\/lib\/utils\/number";/,
    "Inline editor must use the same locale-aware amount parser as the edit sheet",
  );
  assert.match(
    source,
    /const newBudgetedValue = parseLocaleNumber\(value\);/,
    "Inline editor must preserve comma-decimal budget amounts instead of parseFloat truncating them",
  );
  assert.match(
    source,
    /if\s*\(\s*!Number\.isFinite\(newBudgetedValue\)\s*\|\|\s*newBudgetedValue\s*<=\s*0\s*\)\s*{[\s\S]*?toast\.error\(t\("budget-amount-positive"\)\);[\s\S]*?return false;[\s\S]*?}\s*[\s\S]*?editBudgetCategoryMutation\.mutate/s,
    "Inline editor must reject blank, zero, and negative values before mutating the budget category",
  );
});

test("editable table cells reset when a commit is rejected", () => {
  const source = readSource("components/ui/Table/Cell/TableCellEditable.tsx");

  assert.match(
    source,
    /const\s+didCommit\s*=\s*updateData\(row,\s*column\.id,\s*value\);[\s\S]*?if\s*\(didCommit\s*===\s*false\)\s*{[\s\S]*?setValue\(initialValue\);[\s\S]*?}/s,
    "Editable cells must restore the previous visible value when validation rejects a commit",
  );
});
