import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function expectPattern(source: string, pattern: RegExp, message: string) {
  if (!pattern.test(source)) throw new Error(message);
}

const source = read("app/[locale]/(no-layout)/budgets/wizard/categories/page.tsx");

if (
  !/const\s+budgetRemaining\s*=\s*averageMonthlyIncome\s*-\s*totalMonthlyExpenses\s*;/.test(
    source,
  )
) {
  throw new Error(
    "budgetRemaining must be defined as averageMonthlyIncome - totalMonthlyExpenses.",
  );
}

/*
 * The three hand-built summary cards became shared `<StatCard>`s (RAD-619), so
 * the block is now bounded by the tile's own props rather than by a `<Card>`.
 * What this guard protects is unchanged: the remaining figure keeps its sign,
 * is never clamped, and is still marked once it goes negative.
 */
const budgetRemainingCard = source.match(
  /label=\{t\("budget-remaining"\)\}[\s\S]*?\/>/,
);

if (!budgetRemainingCard) {
  throw new Error("Budget remaining card block was not found.");
}

if (!/value=\{\s*budgetRemaining\s*\}/.test(budgetRemainingCard[0])) {
  throw new Error(
    "Budget remaining card must render budgetRemaining without altering its sign.",
  );
}

if (/Math\.abs\(\s*budgetRemaining\s*\)/.test(budgetRemainingCard[0])) {
  throw new Error(
    "Budget remaining card must not use Math.abs(budgetRemaining).",
  );
}

if (
  /Math\.max\(\s*0\s*,\s*budgetRemaining\s*\)|Math\.max\(\s*budgetRemaining\s*,\s*0\s*\)/.test(
    budgetRemainingCard[0],
  )
) {
  throw new Error(
    "Budget remaining card must not clamp budgetRemaining with Math.max().",
  );
}

expectPattern(
  budgetRemainingCard[0],
  /tone="threshold"/,
  "Budget wizard remaining card must apply state-based text styling to negative remaining amounts.",
);

const formatCurrencySource = read("lib/utils/formatCurrency.ts");

// The single `getFinancialValueClassName` was split into three (DESIGN_HISTORY.md
// rule 2): a level is never coloured by sign, a delta is, and a threshold is
// marked only on the breach side. What this guard protects is unchanged — a
// negative that *does* warrant marking must use `-text`, never the raw
// `text-destructive` fill, which measures 1.97:1 in dark mode.
expectPattern(
  formatCurrencySource,
  /getThresholdClassName\s*=\s*\(\s*value:\s*number/,
  "formatCurrency utilities must expose getThresholdClassName for levels that go negative.",
);
expectPattern(
  formatCurrencySource,
  /getDeltaClassName\s*=\s*\(\s*value:\s*number/,
  "formatCurrency utilities must expose getDeltaClassName for changes against a baseline.",
);
expectPattern(
  formatCurrencySource,
  /getThresholdClassName[\s\S]*?value\s*<\s*0[\s\S]*?text-destructive-text/,
  "getThresholdClassName must mark negative values with the accessible destructive text token (text-destructive fails 1.97:1 in dark mode).",
);
expectPattern(
  formatCurrencySource,
  /getAmountClassName\s*=\s*\(\s*\)\s*=>\s*`text-foreground/,
  "getAmountClassName must render a plain level in foreground ink — a balance is not coloured by its sign.",
);

const budgetTableSource = read("components/budget/BudgetTable.tsx");
/*
 * Threshold styling now travels through `<Amount tone="threshold">` rather than a
 * class on the wrapper. That is not cosmetic: `<Amount>` sets its own text colour,
 * so a `getThresholdClassName` on an enclosing element is *overridden* and an
 * overspent budget renders in ordinary foreground ink. The migration to `<Amount>`
 * hit exactly that, and this guard is what caught it — so it now asserts the tone,
 * which is the thing that actually determines the colour.
 */
expectPattern(
  budgetTableSource,
  /tone="threshold"|getThresholdClassName\(remaining\)/,
  "Budget category remaining values must use threshold styling — neutral while there is headroom, destructive once overspent.",
);
expectPattern(
  budgetTableSource,
  /(<Amount[^>]*value=\{remaining\})|formatCurrency\(remaining,\s*currency/s,
  "Budget category remaining values must render the signed remaining value directly, not an absolute value.",
);

const budgetTableNewSource = read("components/budget/BudgetTableNew.tsx");
expectPattern(
  budgetTableNewSource,
  /const\s+totalMonthlySavings\s*=\s*monthlyIncome\s*-\s*totalMonthly\s*;/,
  "Budget table savings must be calculated as income minus planned total.",
);
expectPattern(
  budgetTableNewSource,
  /getThresholdClassName\(totalMonthlySavings\)/,
  "Budget table savings totals must use threshold styling — neutral when saving, destructive when overspending.",
);
expectPattern(
  budgetTableNewSource,
  /formatCurrency\(totalMonthlySavings,\s*currency/,
  "Budget table savings must format the signed savings value directly.",
);

const dashboardBudgetsSource = read("components/dashboard/DashboardBudgetsTable.tsx");
expectPattern(
  dashboardBudgetsSource,
  /isOverBudget\s*\?\s*"text-destructive-text"/,
  "Dashboard budget status percentages must use the accessible destructive text token when over budget (text-destructive fails 1.97:1 in dark mode).",
);

const dashboardNetworthSource = read("components/dashboard/DashboardNetworthTable.tsx");
expectPattern(
  dashboardNetworthSource,
  /getAmountClassName\(\)/,
  "Dashboard net worth balances are levels, not deltas: they must not be coloured by sign. Each row already carries \"of assets\" / \"of debts\" beside the figure, and the minus sign says the rest.",
);
expectPattern(
  dashboardNetworthSource,
  /(<Amount[^>]*value=\{row\.balance\})|formatCurrency\(\s*row\.balance/s,
  "Dashboard net worth balances must render the signed balance directly, not an absolute value.",
);

console.log("Budget remaining sign regression checks passed");
