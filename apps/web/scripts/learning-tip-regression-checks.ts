import { existsSync, readFileSync } from "node:fs";

const locales = ["en", "pt", "es"];
const messageKeys = [
  "monthly-income-help",
  "monthly-income-help-label",
  "total-budgeted-help",
  "total-budgeted-help-label",
  "budget-remaining-help",
  "budget-remaining-help-label",
  "budget-categories-help",
  "budget-categories-help-label",
  "portfolio-currency-help",
  "portfolio-currency-help-label",
  "recurrence-help",
  "recurrence-help-label",
  "metric-unavailable-help",
  "risk-level-help",
  "metric-help-label",
];

const failures: string[] = [];
const targetFiles = [
  "components/portfolio/PortfolioCreateDialog.tsx",
  "components/budget/IncomeNewEditDialog.tsx",
  "components/portfolio/PortfolioMetrics.tsx",
  "app/[locale]/(no-layout)/budgets/wizard/categories/page.tsx",
  "components/onboarding/DashboardOnboarding.tsx",
  "components/account/AccountTransactionImportModal.tsx",
];

function fail(message: string) {
  failures.push(message);
}

if (!existsSync("components/ui/learning-tip.tsx")) fail("components/ui/learning-tip.tsx should exist");

for (const file of targetFiles) {
  if (!existsSync(file)) {
    fail(`${file} should exist`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  if (!source.includes('from "@/components/ui/learning-tip"')) fail(`${file} should import LearningTip`);
  if (source.includes("TooltipTrigger") || source.includes("TooltipContent") || source.includes("TooltipProvider")) {
    fail(`${file} should not keep ad hoc help tooltip blocks`);
  }
  if (source.includes('<span className="sr-only">')) {
    fail(`${file} should not use LearningTip as an icon-only trigger`);
  }
}

if (existsSync("components/onboarding/DashboardOnboarding.tsx")) {
  const dashboardOnboarding = readFileSync(
    "components/onboarding/DashboardOnboarding.tsx",
    "utf8",
  );
  const plainLearningTipTrigger = /trigger=\{\s*<LearningTip([^>]*)>/.exec(
    dashboardOnboarding,
  );
  if (plainLearningTipTrigger && !plainLearningTipTrigger[1].includes("asButton")) {
    fail(
      "DashboardOnboarding should use LearningTip asButton when used as DrawerDialog trigger",
    );
  }
}

for (const locale of locales) {
  const messagesFile = `messages/${locale}/common.json`;
  const messages = JSON.parse(readFileSync(messagesFile, "utf8")) as Record<string, string>;
  for (const key of messageKeys) {
    if (!messages[key]) fail(`${messagesFile} should define ${key}`);
  }
}

if (failures.length > 0) {
  console.error("Learning tip regression checks failed:\n");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Learning tip regression checks passed");
