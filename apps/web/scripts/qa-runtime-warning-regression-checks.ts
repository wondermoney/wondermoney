import { readFileSync } from "node:fs";

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

const dialogSource = readFileSync("components/ui/dialog-responsive.tsx", "utf8");
if (
  !/const dialogContentProps = description[\s\S]*aria-describedby/.test(
    dialogSource,
  )
) {
  fail(
    "dialog-responsive.tsx should explicitly handle aria-describedby on DialogContent when description is absent",
  );
}

const inputSource = readFileSync("components/ui/input.tsx", "utf8");
if (
  !/Object\.prototype\.hasOwnProperty\.call\(props, "value"\)[\s\S]*value\s*===\s*undefined[\s\S]*value:\s*""/.test(
    inputSource,
  )
) {
  fail(
    "input.tsx should normalize value={undefined} to an empty string before passing props to <input>",
  );
}

const textareaSource = readFileSync("components/ui/textarea.tsx", "utf8");
if (
  !/Object\.prototype\.hasOwnProperty\.call\(props, "value"\)[\s\S]*value\s*===\s*undefined[\s\S]*value:\s*""/.test(
    textareaSource,
  )
) {
  fail(
    "textarea.tsx should normalize value={undefined} to an empty string before passing props to <textarea>",
  );
}

const transactionsTableSource = readFileSync(
  "components/account/AccountTransactionsTable.tsx",
  "utf8",
);
if (/columnHelper\.accessor\(\s*"transactionMerchantKey\.name"/.test(transactionsTableSource)) {
  fail(
    "AccountTransactionsTable should not use nested accessor string transactionMerchantKey.name; use a function accessor or explicit id: \"transactionMerchant\"",
  );
}

const budgetTableSource = readFileSync("components/budget/BudgetTableNew.tsx", "utf8");
if (/setData\(\(old\) => \{[\s\S]*?onBudgetChange\?\.\(updated\)/.test(budgetTableSource)) {
  fail(
    "BudgetTableNew should not call onBudgetChange inside a setData updater callback",
  );
}

if (/skipBudgetChangeNotifyRef/.test(budgetTableSource)) {
  fail(
    "BudgetTableNew should not use a sticky skip ref that can suppress later local budget-change notifications",
  );
}

if (!/setData\(updated\);[\s\S]*?onBudgetChange\?\.\(updated\)/.test(budgetTableSource)) {
  fail(
    "BudgetTableNew should notify parent budget changes after local state updates, outside React state updater callbacks",
  );
}

if (/subIndex\s*===\s*subCategoryIndex/.test(budgetTableSource)) {
  fail(
    "BudgetTableNew should apply mutation results by stable category keys instead of stale TanStack row index paths",
  );
}

if (/subIndex\)\s*=>\s*subIndex\s*!==\s*subCategoryIndex/.test(budgetTableSource)) {
  fail(
    "BudgetTableNew should delete mutation results by stable category keys instead of stale TanStack row index paths",
  );
}

// The local getParentBudgetedAmount() helper (inline
// convertMonthlyAmountToAnuallizedMonthlyAmount reducer) was extracted into
// the shared calculateParentBudgetedFromSubRows() utility in
// lib/utils/budget.ts (see "fix: resolve budget wizard QA
// inconsistencies"), reused by both the edit and delete update paths.
const editAndDeleteRollupCalls = (
  budgetTableSource.match(/calculateParentBudgetedFromSubRows\(/g) ?? []
).length;
if (
  !/calculateParentBudgetedFromSubRows,?/.test(budgetTableSource) ||
  !/from "@\/lib\/utils\/budget"/.test(budgetTableSource) ||
  editAndDeleteRollupCalls < 2
) {
  fail(
    "BudgetTableNew should share recurrency-aware parent budget rollup logic for edit and delete updates",
  );
}

if (failures.length > 0) {
  console.error("QA runtime warning regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("QA runtime warning regression checks passed");
