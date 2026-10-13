import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { buildDependentsSchema } from "@/app/[locale]/(no-layout)/budgets/wizard/store";

const wizardRoot = join(
  process.cwd(),
  "app/[locale]/(no-layout)/budgets/wizard",
);

const readWizardStep = (step: string) =>
  readFileSync(join(wizardRoot, step, "page.tsx"), "utf8");

test("wizard form steps submit through the form element", () => {
  for (const step of ["household", "dependents", "income"]) {
    const source = readWizardStep(step);
    assert.match(
      source,
      /<FormContent[^>]*onSubmit=\{methods\.handleSubmit\(onSubmit\)\}/s,
    );
  }
});

test("RAD-638: dependents equal to household size is valid, not blocked", () => {
  const schema = buildDependentsSchema({ householdSize: 2 }, "too many");

  // The reported repro: a single-parent household of 2 with 2 dependents.
  // This is also the slider's own max, so it must never be rejected.
  const atMax = schema.safeParse({ dependentsNum: 2 });
  assert.equal(atMax.success, true);

  const belowMax = schema.safeParse({ dependentsNum: 1 });
  assert.equal(belowMax.success, true);
});

test("RAD-638: dependents above household size is still rejected with a visible message", () => {
  const schema = buildDependentsSchema({ householdSize: 2 }, "too many");

  const aboveMax = schema.safeParse({ dependentsNum: 3 });
  assert.equal(aboveMax.success, false);
  if (!aboveMax.success) {
    assert.equal(aboveMax.error.issues[0]?.path[0], "dependentsNum");
    assert.equal(aboveMax.error.issues[0]?.message, "too many");
  }
});

test("RAD-638: dependents validation is a no-op before household data exists", () => {
  const schema = buildDependentsSchema(undefined, "too many");

  const result = schema.safeParse({ dependentsNum: 999 });
  assert.equal(result.success, true);
});

test("wizard finish button is an explicit non-submit button", () => {
  const source = readWizardStep("categories");
  assert.match(
    source,
    /<Button[^>]*type="button"[^>]*onClick=\{onBudgetComplete\}/s,
  );
});

test("category form clears disabled budget fields when switching back to parent mode", () => {
  const source = readFileSync(
    join(process.cwd(), "components/budget/WizardAddCategoryForm.tsx"),
    "utf8",
  );

  assert.match(source, /methods\.setValue\("budgetAmount", 0/s);
  assert.match(source, /methods\.setValue\("recurrency", "MONTHLY"/s);
});

test("wizard store persists only starter profile key as client-only state", () => {
  const source = readFileSync(join(wizardRoot, "store.ts"), "utf8");

  assert.match(source, /starterProfileKey\?:\s*BudgetStarterProfileKey/s);
  assert.match(source, /setStarterProfileSelection:/s);
  assert.doesNotMatch(source, /starterCategorySuggestions/s);
});

test("categories step lets users choose a starter profile before reviewing categories", () => {
  const source = readWizardStep("categories");

  assert.match(source, /BUDGET_STARTER_PROFILES/s);
  assert.match(source, /setStarterProfileSelection/s);
  assert.match(source, /useEditBudgetCategory/s);
  assert.match(source, /mutateAsync/s);
  assert.match(source, /matchedCount/s);
  assert.match(source, /changedRows/s);
  assert.match(source, /budget-starter-profile-title/s);
  assert.match(source, /role="radiogroup"/s);
  assert.match(source, /aria-checked=\{isSelected\}/s);
  assert.doesNotMatch(source, /selectedStarterSuggestions\.slice/s);
  assert.match(source, /onApplyStarterProfile/s);
  assert.match(source, /budget-starter-profile-apply/s);
  assert.match(source, /loading=\{isApplyingStarterProfile\}/s);
  assert.match(source, /budget-starter-profile-applied/s);
  assert.match(source, /budget-starter-profile-already-applied/s);
  assert.match(source, /applyBudgetStarterProfileToBudgetRows/s);
});

test("RAD-659: picking a starter profile card does not itself change budget rows", () => {
  const source = readWizardStep("categories");

  // Isolate the selection handler's body — it must only record which
  // profile is selected. Applying/persisting suggested amounts belongs
  // exclusively to onApplyStarterProfile, triggered by the "Apply
  // suggestions" button. If selection alone were to also update the
  // table (the RAD-659 bug), clicking Apply afterwards would visibly do
  // nothing, since the table would already show the suggested amounts.
  const selectHandlerMatch = source.match(
    /const onStarterProfileSelect = \([^)]*\) => \{([\s\S]*?)\n {2}\};/,
  );
  assert.ok(
    selectHandlerMatch,
    "expected to find the onStarterProfileSelect handler",
  );

  const selectHandlerBody = selectHandlerMatch![1];
  assert.match(selectHandlerBody, /setStarterProfileSelection\(profileKey\)/);
  assert.doesNotMatch(selectHandlerBody, /setBudgetRows/);
  assert.doesNotMatch(
    selectHandlerBody,
    /applyBudgetStarterProfileToBudgetRows/,
  );
});

test("RAD-659: applying starter suggestions updates visible rows only after the mutation succeeds, from live table state", () => {
  const source = readWizardStep("categories");

  const applyHandlerMatch = source.match(
    /const onApplyStarterProfile = async \(\) => \{([\s\S]*?)\n {2}\};/,
  );
  assert.ok(
    applyHandlerMatch,
    "expected to find the onApplyStarterProfile handler",
  );

  const applyHandlerBody = applyHandlerMatch![1];

  // Suggestions must be computed against the live table (currentBudgetRows),
  // not the original stale query data — otherwise manual edits or a second
  // profile switch would be silently discarded.
  assert.match(
    applyHandlerBody,
    /applyBudgetStarterProfileToBudgetRows\(\{\s*rows: currentBudgetRows,/,
  );

  // setBudgetRows must come after the mutations resolve (inside the `try`,
  // after `await Promise.all`), so the table only visibly updates once the
  // amounts are actually saved.
  const awaitIndex = applyHandlerBody.indexOf("await Promise.all");
  const setBudgetRowsIndex = applyHandlerBody.indexOf("setBudgetRows(");
  assert.ok(awaitIndex >= 0, "expected the persist mutation await");
  assert.ok(setBudgetRowsIndex >= 0, "expected a setBudgetRows call");
  assert.ok(
    setBudgetRowsIndex > awaitIndex,
    "setBudgetRows must run after the mutations are awaited, not before",
  );
});

test("wizard explains which income is used for category suggestions", () => {
  const incomeSource = readWizardStep("income");
  const categoriesSource = readWizardStep("categories");

  assert.match(incomeSource, /income-used-for-guided-setup/s);
  assert.match(categoriesSource, /budget-calculation-explanation/s);
  assert.match(categoriesSource, /budget-calculation-methodology/s);
  assert.match(categoriesSource, /isMethodologyOpen/s);
  assert.match(categoriesSource, /budget-calculation-methodology-title/s);
});

test("advanced category creation is collapsed behind review-first copy", () => {
  const source = readFileSync(
    join(process.cwd(), "components/budget/WizardAddCategoryForm.tsx"),
    "utf8",
  );

  assert.match(source, /isAdvancedOpen/s);
  assert.match(source, /budget-advanced-category-editing/s);
  assert.match(source, /budget-advanced-category-editing-description/s);
  assert.match(source, /aria-expanded=\{isAdvancedOpen\}/s);
  assert.match(source, /budget-show-advanced-category-options/s);
  assert.match(source, /budget-hide-advanced-category-options/s);
  assert.match(source, /category-name-required/s);
  assert.match(source, /budget-amount-required-for-child-category/s);
});
