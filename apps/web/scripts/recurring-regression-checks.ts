import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const client = read(
  "app/[locale]/(full-layout)/accounts/recurring/recurring-client.tsx",
);
const categoryImpact = read(
  "components/recurring/RecurringCategoryImpact.tsx",
);
const itemsTable = read("components/recurring/RecurringItemsTable.tsx");
const itemActions = read("components/recurring/RecurringItemActions.tsx");
const detectionEmptyState = read(
  "components/recurring/RecurringDetectionEmptyState.tsx",
);
const amountDisplay = read("components/recurring/RecurringAmountDisplay.tsx");
const mobileMoreItems = read("components/layout/mobile-more-nav-items.ts");
const upcoming = read("components/recurring/RecurringUpcomingTimeline.tsx");

assert.doesNotMatch(client, /trigger=\{<>\s*<\/>\}/);
assert.match(client, /useDetectRecurring/);
assert.match(client, /trigger=\{false\}/);
assert.match(client, /window\.setInterval/);
assert.match(client, /normalizeFinancialLocale/);
assert.match(client, /Math\.min\(\s*0,/);
assert.match(client, /tableItems/);
assert.match(client, /variant="h1"/);
assert.match(client, /variant="h2"/);
assert.match(itemActions, /status !== "candidate"/);
assert.match(itemActions, /status === "confirmed"/);
assert.match(itemActions, /status === "dismissed"/);
assert.match(itemsTable, /2xl:hidden/);
assert.match(itemActions, /min-h-11/);
assert.doesNotMatch(categoryImpact, /Math\.max\(4,/);
assert.doesNotMatch(categoryImpact, /const withCategory = items\.filter/);
assert.match(categoryImpact, /<meter/);
assert.match(upcoming, /referenceTime/);
assert.match(upcoming, /timestamp > referenceTime/);
assert.match(detectionEmptyState, /RecurringPaymentsPreview/);
assert.match(amountDisplay, /formatCurrencyForScreenReader/);
assert.match(mobileMoreItems, /accounts\.recurring/);

const catalogs = ["en", "pt", "es"].map((locale) => {
  const parsed = JSON.parse(read(`messages/${locale}/common.json`)) as {
    recurring?: Record<string, unknown>;
  };
  return [locale, Object.keys(parsed.recurring ?? {}).sort()] as const;
});
const [, englishKeys] = catalogs[0] ?? ["en", []];
for (const [locale, keys] of catalogs.slice(1)) {
  assert.deepEqual(keys, englishKeys, `${locale} recurring keys must match en`);
}

console.log("Recurring payments regression checks passed");
