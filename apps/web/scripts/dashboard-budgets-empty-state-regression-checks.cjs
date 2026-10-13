const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");

function read(path) {
  const absolutePath = join(root, path);

  if (!existsSync(absolutePath)) {
    throw new Error(`Missing expected file: ${path}`);
  }

  return readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const componentPath = "components/dashboard/DashboardBudgetsEmptyState.tsx";
const homeClientPath = "app/[locale]/(full-layout)/home-client.tsx";
const localeKeys = [
  "budget-empty-state-title",
  "budget-empty-state-description",
  "create-first-budget",
  "help-hint-budgets",
];

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

const component = read(componentPath);
const homeClient = read(homeClientPath);

assert(
  component.includes("export function DashboardBudgetsEmptyState") ||
    component.includes("export const DashboardBudgetsEmptyState") ||
    component.includes("export default DashboardBudgetsEmptyState"),
  "DashboardBudgetsEmptyState should be exported",
);

assert(
  homeClient.includes(
    'import DashboardBudgetsEmptyState from "@/components/dashboard/DashboardBudgetsEmptyState"',
  ),
  "home-client.tsx should import DashboardBudgetsEmptyState",
);

assert(
  homeClient.includes("<DashboardBudgetsEmptyState />"),
  "home-client.tsx should render DashboardBudgetsEmptyState",
);

assert(
  !homeClient.includes('t("no-budgets")'),
  'home-client.tsx should no longer use t("no-budgets") in the budgets fallback',
);

assert(
  component.includes('href="/budgets/wizard"'),
  "DashboardBudgetsEmptyState should link to the budget wizard",
);

for (const key of localeKeys) {
  assert(component.includes(key), `DashboardBudgetsEmptyState should use ${key}`);
}

for (const token of [
  "CategoryIcon",
  "getCategoryTranslationKey",
  "formatCurrency",
  "create-first-budget",
  "repeating-linear-gradient",
  "PreviewBadge",
]) {
  assert(
    component.includes(token),
    `DashboardBudgetsEmptyState should use ${token}`,
  );
}

assert(
  component.includes("grid") && component.includes("lg:grid-cols"),
  "DashboardBudgetsEmptyState should use a responsive split layout",
);

assert(
  component.includes("/budgets/wizard"),
  "DashboardBudgetsEmptyState should link to the budget wizard",
);

for (const literal of [
  "formatPercentage",
  "Remaining",
  "budget-empty-state-preview-label",
  "budget-empty-state-metric-label",
  "budget-empty-state-preview-groceries",
  "budget-empty-state-preview-rent",
  "budget-empty-state-preview-dining",
  "text-blue",
  "bg-blue",
  "border-l-blue",
  "indicatorClassName",
]) {
  assert(
    !component.includes(literal),
    `DashboardBudgetsEmptyState should not include ${literal}`,
  );
}

for (const token of [
  'const budgets = budgetsData?.budgets ?? []',
  'const hasBudgets = budgetCount > 0',
  'hasBudget={hasBudgets}',
  '{hasBudgets ? (',
]) {
  assert(
    homeClient.includes(token),
    `home-client.tsx should include ${token}`,
  );
}

// The SectionHeader budgets "view all" action still renders only when
// hasBudgets, but Prettier reformatted `actions={hasBudgets ? (` onto its own
// line (commit cbd352f4), so match across optional whitespace rather than as a
// brittle single-line substring.
assert(
  /actions=\{\s*hasBudgets \? \(/.test(homeClient),
  "home-client.tsx should gate the budgets section header action on hasBudgets",
);

for (const antiPattern of [
  "emoji",
  "Illustration",
  "illustration",
  "bg-gradient",
  "animate-",
  "confetti",
]) {
  assert(
    !component.includes(antiPattern),
    `DashboardBudgetsEmptyState should not contain ${antiPattern}`,
  );
}

for (const literal of [
  "Create your first budget",
  "Start with suggested category limits based on your spending",
  "Budget preview",
  "Actual / Budgeted",
  "Create budget",
]) {
  assert(
    !component.includes(literal),
    `DashboardBudgetsEmptyState should not hard-code literal copy: ${literal}`,
  );
}

for (const localeDir of readdirSync(join(root, "messages"), {
  withFileTypes: true,
})) {
  if (!localeDir.isDirectory()) continue;

  const commonPath = `messages/${localeDir.name}/common.json`;
  if (!existsSync(join(root, commonPath))) continue;

  const localeCommon = JSON.parse(read(commonPath));
  for (const key of localeKeys) {
    assert(
      Object.prototype.hasOwnProperty.call(localeCommon, key),
      `${commonPath} should include ${key}`,
    );
  }

  for (const removedKey of [
    "budget-empty-state-metric-label",
    "budget-empty-state-preview-label",
    "budget-empty-state-preview-groceries",
    "budget-empty-state-preview-rent",
    "budget-empty-state-preview-dining",
  ]) {
    assert(
      !Object.prototype.hasOwnProperty.call(localeCommon, removedKey),
      `${commonPath} should not include unused ${removedKey}`,
    );
  }
}

console.log("Dashboard budgets empty state regression checks passed");
