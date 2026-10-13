/**
 * Guards three RAD-633 fixes in the budget-creation wizard
 * (`app/[locale]/(no-layout)/budgets/wizard/`). All three shipped from a
 * single root cause plus one independent backend-integration gap, found by
 * reproducing the wizard end-to-end against a live API rather than by
 * reading the code alone:
 *
 * 1. Ignored entered income / silently duplicated budgets — both traced to
 *    the SAME bug. `IncomeNewEditDialog` renders inside a Radix
 *    `DialogContent`/`DrawerContent`, which portals its DOM node to
 *    `document.body` (components/ui/dialog-responsive.tsx). React
 *    re-dispatches synthetic events along the *component* tree, not the DOM
 *    tree, so a `submit` fired by the dialog's own `<form>` still bubbles up
 *    to the wizard income step's outer `<form onSubmit=...>`, even though
 *    the two elements are unrelated in the DOM. Submitting the dialog (Add
 *    Income / editing an income row) was therefore ALSO submitting the
 *    wizard step — silently calling `useCreateBudget` mid-edit, before the
 *    user ever reached "Continue", using whichever `incomes` value the
 *    outer form happened to hold at that instant. Confirmed live: the
 *    captured `POST /v1/budget` body carried the untouched default income
 *    even after editing the amount in the dialog. Fixed by stopping
 *    propagation on the dialog's own submit. A second, defensive fix makes
 *    the income step's own submit idempotent: if a `budgetId` is already in
 *    wizard state, re-submitting resumes that budget instead of creating a
 *    second "My Budget" (this also covers browser-Back re-entry after the
 *    wizard already finished once, since the wizard's Zustand store isn't
 *    persisted or route-scoped — categories now clears it on Finish).
 *
 * 2. Ignored real spending already logged — a wizard-created budget starts
 *    with zero linked accounts. The backend's per-category "spent" figure
 *    (`GET /v1/budget/:id/:year/:month`) is a join scoped to exactly the
 *    accounts linked to that budget, not a date-range or creation-order
 *    filter — confirmed live via curl: a transaction dated inside the
 *    budget's month, correctly categorized, read back as `category_amount:
 *    0` until the budget's accounts were linked, then `650` once they were.
 *    The wizard has no account-selection step of its own (unlike the
 *    existing "Link account" control on the budget page,
 *    components/budget/BudgetAccountSelectModal.tsx), so newly created
 *    budgets now link every account the user can already see by default,
 *    right after creation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const incomeDialogPath = "components/budget/IncomeNewEditDialog.tsx";
const incomeDialog = stripComments(read(incomeDialogPath));

// --- 1. the income dialog's submit no longer bubbles into the outer wizard form ---

assert.match(
  incomeDialog,
  /onSubmit=\{\s*\(event\)\s*=>\s*\{[\s\S]{0,200}event\.stopPropagation\(\)/,
  `${incomeDialogPath}: this dialog is portalled (DrawerDialog -> Radix Dialog/Drawer), so its ` +
    "own <form onSubmit> must call event.stopPropagation() before delegating to " +
    "react-hook-form's handleSubmit — otherwise the submit event still reaches the wizard " +
    "income step's outer form via React's component-tree event bubbling (RAD-633), firing " +
    "useCreateBudget on every income edit instead of only on a real 'Continue' click.",
);

assert.match(
  incomeDialog,
  /event\.stopPropagation\(\);\s*return methods\.handleSubmit\(onSubmit\)\(event\);/,
  `${incomeDialogPath}: stopPropagation must run before the dialog's own handleSubmit, and the ` +
    "dialog's onSubmit must still actually run — a stray stopPropagation with no handleSubmit " +
    "call would silently break adding/editing income altogether.",
);

// --- 2. the income step's create-budget submit is idempotent per wizard pass ---

const incomeStepPath =
  "app/[locale]/(no-layout)/budgets/wizard/income/page.tsx";
const incomeStep = stripComments(read(incomeStepPath));

assert.match(
  incomeStep,
  /budgetId,\s*setBudgetId/,
  `${incomeStepPath}: must read the wizard store's budgetId (not just setBudgetId) so a ` +
    "re-submission of this step can tell whether a budget already exists for this pass.",
);

assert.match(
  incomeStep,
  /if\s*\(budgetId\)\s*\{[\s\S]{0,200}router\.push\("\/budgets\/wizard\/categories"\);[\s\S]{0,40}return;\s*\}/,
  `${incomeStepPath}: onSubmit must short-circuit to the categories step, without calling ` +
    "useCreateBudget again, when a budgetId is already set — otherwise re-entering this step " +
    "(e.g. browser Back after already submitting it once) mints a second budget (RAD-633).",
);

// --- 3. wizard completion clears in-progress state so a later visit can't resume it ---

const categoriesStepPath =
  "app/[locale]/(no-layout)/budgets/wizard/categories/page.tsx";
const categoriesStep = stripComments(read(categoriesStepPath));

assert.match(
  categoriesStep,
  /resetWizard:\s*state\.reset/,
  `${categoriesStepPath}: must pull the store's reset action so a completed wizard pass can ` +
    "clear itself.",
);

assert.match(
  categoriesStep,
  /const onBudgetComplete = \(\) => \{[\s\S]{0,200}resetWizard\(\);/,
  `${categoriesStepPath}: onBudgetComplete must call resetWizard() — this wizard's Zustand ` +
    "store is a module singleton, not persisted or route-scoped, so without a reset a later " +
    "visit that lands back on an earlier step (browser Back, a stale tab) finds a budgetId " +
    "already set and resumes/duplicates the finished budget instead of starting clean.",
);

// --- 4. a freshly created budget links every visible account by default ---

assert.match(
  incomeStep,
  /import useAccounts from "@\/lib\/api\/account\/useAccounts";/,
  `${incomeStepPath}: must import useAccounts to know which accounts exist to link.`,
);

assert.match(
  incomeStep,
  /import useEditBudgetTemplateAccounts from "@\/lib\/api\/budget\/useEditBudgetTemplateAccounts";/,
  `${incomeStepPath}: must import useEditBudgetTemplateAccounts — the same mutation ` +
    "components/budget/BudgetAccountSelectModal.tsx uses — to link accounts to the new budget.",
);

assert.match(
  incomeStep,
  /editBudgetAccountsMutation\.mutateAsync\(\{\s*budgetKey:\s*response\.data\.budgetKey,\s*accountKeys,?\s*\}\)/,
  `${incomeStepPath}: after creating the budget, must link accountKeys to response.data.budgetKey. ` +
    "A wizard-created budget otherwise starts with zero linked accounts, and the backend's " +
    "per-category 'spent' figure is a join scoped to exactly the accounts linked to the budget " +
    "(not a date-range or budget-creation-date filter) — confirmed live via the API — so every " +
    "category reads '€0.00 spent' forever regardless of real, correctly-dated, correctly-" +
    "categorized transactions until accounts are linked (RAD-633).",
);

assert.match(
  incomeStep,
  /try\s*\{\s*await editBudgetAccountsMutation\.mutateAsync\(\{[\s\S]{0,200}\}\s*catch\s*\{/,
  `${incomeStepPath}: the account-linking call must be wrapped in its own try/catch and must ` +
    "not rethrow — a failure there must not block navigation to the categories step, since " +
    "the budget itself was already created successfully and the user can still link accounts " +
    "manually from the budget page.",
);

console.log("budget wizard create (RAD-633): all checks passed");
