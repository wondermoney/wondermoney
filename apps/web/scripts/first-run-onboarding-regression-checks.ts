import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertMatches(content: string, pattern: RegExp, message: string) {
  assert(pattern.test(content), message);
}

function parseJson(content: string): unknown {
  return JSON.parse(content) as unknown;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function assertStringPath(value: unknown, path: string, message: string) {
  assert(typeof getPath(value, path) === "string", message);
}

const firstRunTypes = read("lib/onboarding/first-run/types.ts");
const gate = read("components/onboarding/first-run/FirstRunOnboardingRedirectGate.tsx");
const fullLayout = read("app/[locale]/(full-layout)/layout.tsx");
const shell = read("components/onboarding/first-run/FirstRunOnboardingShell.tsx");
const routeShell = read(
  "components/onboarding/first-run/FirstRunOnboardingRouteShell.tsx",
);
const syncStep = read("components/onboarding/first-run/FirstRunSyncStep.tsx");
const completeStep = read(
  "components/onboarding/first-run/FirstRunCompleteStep.tsx",
);
const welcomeStep = read(
  "components/onboarding/first-run/FirstRunWelcomeStep.tsx",
);
const goalsStep = read("components/onboarding/first-run/FirstRunGoalsStep.tsx");
const privacyStep = read(
  "components/onboarding/first-run/FirstRunPrivacyStep.tsx",
);
const accountStep = read(
  "components/onboarding/first-run/FirstRunAccountStep.tsx",
);
const accountsClient = read("app/[locale]/(full-layout)/accounts/accounts-client.tsx");
const portfolioPage = read("app/[locale]/(full-layout)/portfolio/page.tsx");
const budgetWizardCategoriesPage = read(
  "app/[locale]/(no-layout)/budgets/wizard/categories/page.tsx",
);
const onboardingRoutes = [
  "app/[locale]/(no-layout)/onboarding/layout.tsx",
  "app/[locale]/(no-layout)/onboarding/welcome/page.tsx",
  "app/[locale]/(no-layout)/onboarding/goals/page.tsx",
  "app/[locale]/(no-layout)/onboarding/privacy/page.tsx",
  "app/[locale]/(no-layout)/onboarding/account/page.tsx",
  "app/[locale]/(no-layout)/onboarding/sync/page.tsx",
  "app/[locale]/(no-layout)/onboarding/complete/page.tsx",
] as const;
const enOnboarding = read("messages/en/onboarding.json");
const ptOnboarding = read("messages/pt/onboarding.json");
const esOnboarding = read("messages/es/onboarding.json");
const enMessages = parseJson(enOnboarding);

for (const route of onboardingRoutes) {
  assert(existsSync(join(root, route)), `expected onboarding route file to exist: ${route}`);
  assert(
    !read(route).includes("FirstRunOnboardingClient"),
    `${route} must not import the stale monolithic onboarding client`,
  );
}
assert(
  !existsSync(
    join(root, "components/onboarding/first-run/FirstRunOnboardingClient.tsx"),
  ),
  "stale monolithic FirstRunOnboardingClient must be removed",
);
for (const route of [
  "app/[locale]/(no-layout)/onboarding/page.tsx",
  "app/[locale]/(no-layout)/onboarding/first-run/page.tsx",
] as const) {
  assert(
    !existsSync(join(root, route)),
    `legacy onboarding redirect route must not exist: ${route}`,
  );
}

assert(
  firstRunTypes.includes("FIRST_RUN_ONBOARDING_STORAGE_KEY"),
  "state file must define a storage key",
);
assert(
  firstRunTypes.includes("FIRST_RUN_MAX_GOALS = 2"),
  "goal selection must be capped at 2",
);
assert(
  firstRunTypes.includes("first_run_onboarding_started"),
  "first-run analytics events must be declared",
);
assert(
  !firstRunTypes.includes(': "onboarding_started"'),
  "avoid generic onboarding_started event name",
);
assertMatches(
  firstRunTypes,
  /export const FIRST_RUN_STEPS = \[\s*"welcome",\s*"goals",\s*"privacy",\s*"account",\s*"sync_value",\s*"completion",\s*\] as const;/,
  "state file must define the approved first-run step list",
);
assertMatches(
  firstRunTypes,
  /completed:\s*"first_run_onboarding_completed"/,
  "state file must define first-run completion analytics",
);
assertMatches(
  fullLayout,
  /<FirstRunOnboardingRedirectGate>\s*<Wrapper>[\s\S]*<\/Wrapper>\s*<\/FirstRunOnboardingRedirectGate>/,
  "full-layout must wrap the app shell in the first-run redirect gate",
);
assertMatches(
  gate,
  /const FIRST_RUN_PATH = getFirstRunStepRoute\("welcome"\);/,
  "redirect gate must define FIRST_RUN_PATH from the shared welcome route helper",
);
assertMatches(
  gate,
  /router\.replace\(FIRST_RUN_PATH\s*\)|router\.replace\("\/onboarding\/welcome"\)/,
  "redirect gate must target /onboarding/welcome",
);
assert(
  !gate.includes("/onboarding/first-run?step="),
  "redirect gate must not use query-param step redirects",
);
for (const [label, content] of [
  ["accounts client", accountsClient],
  ["portfolio page", portfolioPage],
  ["budget wizard categories page", budgetWizardCategoriesPage],
] as const) {
  assert(
    !content.includes("/onboarding/first-run?step="),
    `${label} must not reference /onboarding/first-run?step=`,
  );
}
assertMatches(
  routeShell,
  /previousState\.status === "completed"[\s\S]*router\.replace\("\/"\)/,
  "route shell must redirect completed users away from onboarding",
);
assertMatches(
  accountsClient,
  /setRecoveryImportModalOpen[\s\S]*cancelFirstRunHandoff\("account", "account"/,
  "only an explicit recovery import cancellation may cancel the account handoff",
);
assertMatches(
  accountsClient,
  /handleCsvImportSuccess[\s\S]*completeFirstRunHandoff\([\s\S]*getFirstRunStepRoute\("sync_value"\)/,
  "successful statement recovery must complete the account handoff",
);
assertMatches(
  accountsClient,
  /bankSyncIncident\.result === "full_success"/,
  "only authoritative full bank success may advance the first-run handoff",
);
assertMatches(
  routeShell,
  /FIRST_RUN_EVENTS\.started/,
  "route shell must capture first-run started analytics",
);
assertMatches(
  routeShell,
  /FIRST_RUN_EVENTS\.stepViewed/,
  "route shell must capture step viewed analytics",
);
assertMatches(
  completeStep,
  /posthog\?\.capture\(FIRST_RUN_EVENTS\.completed,/,
  "complete step must capture completion event through FIRST_RUN_EVENTS",
);
assertMatches(
  completeStep,
  /duration_seconds:/,
  "complete step completion analytics must include duration_seconds",
);
assertMatches(
  completeStep,
  /router\.replace\("\/"\)/,
  "complete step must replace to dashboard after completion",
);
assertMatches(
  completeStep,
  /t\("completion\.cta"\)/,
  "complete step must use the translated completion CTA",
);
// The first-run flow is intentionally a concise single-column hierarchy. The
// former three-card/product-preview assertions are obsolete and must not return.
assertMatches(shell, /max-w-2xl/, "onboarding shell must use a focused single column");
assert(!shell.includes("rounded-full"), "onboarding progress must not use pill styling");
assert(!routeShell.includes("supportingContent"), "route shell must not restore legacy card content");
assertMatches(syncStep, /t\("continue"\)/, "sync step must use Continue CTA");
assert(
  !syncStep.includes("completion.cta"),
  "sync step must not use the dashboard completion CTA",
);
for (const [label, content] of [
  ["welcome step", welcomeStep],
  ["goals step", goalsStep],
  ["privacy step", privacyStep],
  ["account step", accountStep],
  ["sync step", syncStep],
  ["complete step", completeStep],
] as const) {
  assert(
    content.includes("useFirstRunOnboardingFooter"),
    `${label} must place its primary action in the onboarding shell footer area instead of only inside card content`,
  );
}
assertMatches(
  routeShell,
  /<FirstRunOnboardingShell[\s\S]*footerActions=\{footer\}/,
  "route shell must pass step primary actions into the fixed onboarding shell footer",
);
for (const [label, content] of [
  ["privacy step", privacyStep],
  ["account step", accountStep],
] as const) {
  assert(
    !content.includes('status: "in_progress"'),
    `${label} must not unconditionally reset users to in_progress`,
  );
}
for (const [label, content] of [
  ["redirect gate", gate],
  ["accounts client", accountsClient],
  ["portfolio page", portfolioPage],
  ["budget wizard categories page", budgetWizardCategoriesPage],
] as const) {
  assertMatches(
    content,
    /getFirstRunStepRoute\(/,
    `${label} must use the shared onboarding route helper`,
  );
}
assertMatches(
  shell,
  /mx-auto[\s\S]*w-full[\s\S]*max-w-(?:md|lg|xl|2xl)|max-w-(?:md|lg|xl|2xl)[\s\S]*w-full[\s\S]*mx-auto/,
  "shell must use a focused centered onboarding column",
);
assertMatches(
  shell,
  /fixed[\s\S]*inset-x-0[\s\S]*bottom-0|bottom-0[\s\S]*inset-x-0[\s\S]*fixed/,
  "shell must use a fixed bottom action area",
);
assert(
  !shell.includes("supportingContent"),
  "shell must not include supportingContent in the shell",
);
assertMatches(shell, /onBack[\s\S]*progressLabel/, "shell must expose back navigation and progress");
assertMatches(
  shell,
  /min-h-11/,
  "shell back button must preserve a mobile-safe touch target",
);
assert(
  !shell.includes('size="sm"'),
  'shell must not use size="sm" on the back button',
);
for (const [locale, content] of [
  ["en", enOnboarding],
  ["pt", ptOnboarding],
  ["es", esOnboarding],
] as const) {
  const messages = parseJson(content);

  for (const path of [
    "onboarding.firstRun.welcome.headline",
    "onboarding.firstRun.welcome.description",
    "onboarding.firstRun.welcome.socialProof",
    "onboarding.firstRun.welcome.proof",
    "onboarding.firstRun.welcome.proofNote",
    "onboarding.firstRun.goals.headline",
    "onboarding.firstRun.goals.description",
    "onboarding.firstRun.goals.proof",
    "onboarding.firstRun.goals.proofNote",
    "onboarding.firstRun.goals.options.all_in_one",
    "onboarding.firstRun.goals.options.spending",
    "onboarding.firstRun.goals.options.budget",
    "onboarding.firstRun.goals.options.investments_net_worth",
    "onboarding.firstRun.goals.options.financial_freedom",
    "onboarding.firstRun.goals.options.exploring",
    "onboarding.firstRun.goals.helpers.all_in_one",
    "onboarding.firstRun.goals.helpers.spending",
    "onboarding.firstRun.goals.helpers.budget",
    "onboarding.firstRun.goals.helpers.investments_net_worth",
    "onboarding.firstRun.goals.helpers.financial_freedom",
    "onboarding.firstRun.goals.helpers.exploring",
    "onboarding.firstRun.proofSources.ynab",
    "onboarding.firstRun.proofSources.cfpb",
    "onboarding.firstRun.proofSources.finraInvestorGov",
    "onboarding.firstRun.preview.welcome.cashLabel",
    "onboarding.firstRun.preview.welcome.cashValue",
    "onboarding.firstRun.preview.welcome.netWorthLabel",
    "onboarding.firstRun.preview.welcome.netWorthValue",
    "onboarding.firstRun.preview.welcome.budgetLabel",
    "onboarding.firstRun.preview.welcome.budgetValue",
    "onboarding.firstRun.preview.common.previewLabel",
    "onboarding.firstRun.preview.common.transactionLabel",
    "onboarding.firstRun.preview.common.transactionValue",
    "onboarding.firstRun.preview.common.portfolioLabel",
    "onboarding.firstRun.preview.common.portfolioValue",
    "onboarding.firstRun.preview.goals.selectedLabel",
    "onboarding.firstRun.preview.goals.goalOne",
    "onboarding.firstRun.preview.goals.goalTwo",
    "onboarding.firstRun.preview.privacy.canView",
    "onboarding.firstRun.preview.privacy.cannotMove",
    "onboarding.firstRun.preview.privacy.revoke",
    "onboarding.firstRun.preview.account.sectionLabel",
    "onboarding.firstRun.preview.account.currentAccountLabel",
    "onboarding.firstRun.preview.account.currentAccountValue",
    "onboarding.firstRun.preview.account.savingsLabel",
    "onboarding.firstRun.preview.account.savingsValue",
    "onboarding.firstRun.preview.account.creditCardLabel",
    "onboarding.firstRun.preview.account.creditCardValue",
    "onboarding.firstRun.preview.account.totalLabel",
    "onboarding.firstRun.preview.account.totalValue",
    "onboarding.firstRun.preview.syncValue.balancesLabel",
    "onboarding.firstRun.preview.syncValue.balancesValue",
    "onboarding.firstRun.preview.syncValue.transactionsLabel",
    "onboarding.firstRun.preview.syncValue.transactionsValue",
    "onboarding.firstRun.preview.syncValue.budgetSyncLabel",
    "onboarding.firstRun.preview.syncValue.budgetSyncValue",
    "onboarding.firstRun.preview.syncValue.netWorthSyncLabel",
    "onboarding.firstRun.preview.syncValue.netWorthSyncValue",
    "onboarding.firstRun.preview.completion.profileStarted",
    "onboarding.firstRun.preview.completion.dashboardNext",
    "onboarding.firstRun.account.cta",
    "onboarding.firstRun.account.manualCta",
    "onboarding.firstRun.account.skipWarning.secondary",
    "onboarding.firstRun.privacy.headline",
    "onboarding.firstRun.privacy.description",
    "onboarding.firstRun.privacy.bullets.readOnly.title",
    "onboarding.firstRun.privacy.bullets.readOnly.description",
    "onboarding.firstRun.privacy.bullets.bankAuth.title",
    "onboarding.firstRun.privacy.bullets.bankAuth.description",
    "onboarding.firstRun.privacy.bullets.revoke.title",
    "onboarding.firstRun.privacy.bullets.revoke.description",
    "onboarding.firstRun.syncValue.cards.balances.title",
    "onboarding.firstRun.syncValue.cards.balances.description",
    "onboarding.firstRun.syncValue.cards.transactions.title",
    "onboarding.firstRun.syncValue.cards.transactions.description",
    "onboarding.firstRun.syncValue.cards.budgets.title",
    "onboarding.firstRun.syncValue.cards.budgets.description",
    "onboarding.firstRun.syncValue.cards.netWorth.title",
    "onboarding.firstRun.syncValue.cards.netWorth.description",
    "onboarding.firstRun.syncValue.proofNote",
    "onboarding.firstRun.completion.celebrationHeadline",
    "onboarding.firstRun.completion.connectedCelebrationDescription",
    "onboarding.firstRun.completion.skippedCelebrationDescription",
    "onboarding.firstRun.completion.connectInstead",
    "onboarding.firstRun.completion.cta",
  ]) {
    assertStringPath(
      messages,
      path,
      `${locale} onboarding messages must include ${path}`,
    );
  }

  if (locale !== "en") {
    for (const path of [
      "onboarding.firstRun.proofSources.ynab",
      "onboarding.firstRun.proofSources.cfpb",
      "onboarding.firstRun.proofSources.finraInvestorGov",
      "onboarding.firstRun.preview.welcome.cashLabel",
      "onboarding.firstRun.preview.welcome.netWorthLabel",
      "onboarding.firstRun.preview.welcome.budgetLabel",
      "onboarding.firstRun.preview.goals.selectedLabel",
      "onboarding.firstRun.preview.goals.goalOne",
      "onboarding.firstRun.preview.goals.goalTwo",
      "onboarding.firstRun.preview.privacy.canView",
      "onboarding.firstRun.preview.privacy.cannotMove",
      "onboarding.firstRun.preview.privacy.revoke",
      "onboarding.firstRun.preview.account.sectionLabel",
      "onboarding.firstRun.preview.account.currentAccountLabel",
      "onboarding.firstRun.preview.account.savingsLabel",
      "onboarding.firstRun.preview.account.creditCardLabel",
      "onboarding.firstRun.preview.account.totalLabel",
      "onboarding.firstRun.preview.syncValue.balancesLabel",
      "onboarding.firstRun.preview.syncValue.transactionsLabel",
      "onboarding.firstRun.preview.syncValue.budgetSyncLabel",
      "onboarding.firstRun.preview.syncValue.netWorthSyncLabel",
      "onboarding.firstRun.preview.completion.profileStarted",
      "onboarding.firstRun.preview.completion.dashboardNext",
      "onboarding.firstRun.preview.common.previewLabel",
      "onboarding.firstRun.preview.common.transactionLabel",
      "onboarding.firstRun.preview.common.portfolioLabel",
    ]) {
      assert(
        getPath(messages, path) !== getPath(enMessages, path),
        `${locale} onboarding message must localize ${path}`,
      );
    }
  }
}

console.log("First-run onboarding regression checks passed");
