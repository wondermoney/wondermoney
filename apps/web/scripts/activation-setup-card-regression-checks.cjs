const { existsSync, readFileSync } = require("node:fs");
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

const component = read("components/activation/SetupChecklistCard.tsx");
const homeClient = read("app/[locale]/(full-layout)/home-client.tsx");
const homePage = read("app/[locale]/(full-layout)/page.tsx");
const locales = ["en", "pt", "es"];

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert(
  component.includes("useState"),
  "SetupChecklistCard should use local state for expanding and collapsing steps",
);
assert(
  component.includes("activation-setup-progress-title"),
  "SetupChecklistCard should render the financial profile progress title",
);
assert(
  component.includes("activation-setup-progress-count"),
  "SetupChecklistCard should render a progress count",
);
assert(
  component.includes("progressPercent"),
  "SetupChecklistCard should calculate a progress percentage",
);
assert(
  component.includes('role="progressbar"'),
  "SetupChecklistCard progress indicator should expose progressbar semantics",
);
assert(
  component.includes("aria-expanded={isExpanded}"),
  "View steps control should expose expanded state for assistive technology",
);
assert(
  component.includes("aria-controls={stepsListId}"),
  "View steps control should reference the expanded checklist",
);
assert(
  component.includes("activation-setup-view-steps"),
  "SetupChecklistCard should include a View steps control",
);
assert(
  component.includes("activation-setup-hide-steps"),
  "SetupChecklistCard should include a Hide steps control",
);
assert(
  !component.includes("CardHeader"),
  "SetupChecklistCard should not use the large card header layout",
);
assert(
  !component.includes("CardFooter"),
  "SetupChecklistCard should not use the large card footer layout",
);
assert(
  !component.includes("activation-setup-description"),
  "SetupChecklistCard should not show the long setup description by default",
);
assert(
  component.includes("usePostHog"),
  "SetupChecklistCard should capture profile completeness analytics",
);
assert(
  component.includes("RETENTION_GROWTH_EVENTS"),
  "SetupChecklistCard should use the shared retention/growth event taxonomy",
);
assert(
  component.includes("RETENTION_GROWTH_EVENTS.profileCompletenessViewed"),
  "SetupChecklistCard should capture profile_completeness_viewed when shown",
);
assert(
  component.includes("RETENTION_GROWTH_EVENTS.profileCompletenessItemClicked"),
  "SetupChecklistCard should capture profile_completeness_item_clicked on checklist navigation",
);
assert(
  component.includes("itemKey: step.key") && component.includes("isComplete"),
  "Profile completeness item click events should include item key and completion state",
);
assert(
  !homeClient.includes("hasReviewedTransactions={true}"),
  "HomeClient should not hard-code the transactions checklist item as complete",
);
assert(
  homeClient.includes("initialTransactionsData"),
  "HomeClient should receive transaction presence/review state for profile completeness",
);
assert(
  homePage.includes("getTransactions"),
  "Home page should fetch transaction state for profile completeness",
);

for (const locale of locales) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`));

  for (const key of [
    "activation-setup-progress-title",
    "activation-setup-progress-count",
    "activation-setup-view-steps",
    "activation-setup-hide-steps",
  ]) {
    assert(
      typeof messages[key] === "string" && messages[key].length > 0,
      `${locale} common messages must include ${key}`,
    );
  }
}

const expectedProgressTitles = {
  en: "Finish setting up your dashboard",
  pt: "Termine de configurar o seu dashboard",
  es: "Termina de configurar tu dashboard",
};

for (const [locale, title] of Object.entries(expectedProgressTitles)) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`));

  assert(
    messages["activation-setup-progress-title"] === title,
    `${locale} activation setup title should frame the card as profile completeness`,
  );
}

console.log("Activation setup card regression checks passed");
