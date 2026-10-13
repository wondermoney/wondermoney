import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const analyticsHelperPath = "lib/utils/analytics-enabled.ts";
const analyticsTaxonomyPath = "lib/analytics/events.ts";
const providers = read("app/providers.tsx");
const analyticsRuntime = read("components/analytics/AnalyticsInit.tsx");
const rootLayout = read("app/[locale]/layout.tsx");
const pageViewPath = "app/AnalyticsPageView.tsx";

const retentionGrowthEvents = [
  "profile_completeness_viewed",
  "profile_completeness_item_clicked",
  "insight_card_viewed",
  "insight_card_clicked",
  "insight_card_dismissed",
  "weekly_digest_sent",
  "weekly_digest_opened",
  "weekly_digest_clicked",
] as const;

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert.equal(
  existsSync(analyticsHelperPath),
  true,
  "analytics enablement should be centralized in lib/utils/analytics-enabled.ts",
);

const analyticsHelper = read(analyticsHelperPath);
const analyticsTaxonomy = read(analyticsTaxonomyPath);

assert.match(
  analyticsTaxonomy,
  /RETENTION_GROWTH_EVENTS/,
  "retention/growth analytics taxonomy should expose grouped event constants",
);

for (const eventName of retentionGrowthEvents) {
  assert.match(
    analyticsTaxonomy,
    new RegExp(`\\b${eventName}\\b`),
    `retention/growth analytics taxonomy should document ${eventName}`,
  );
}

assert.match(
  analyticsHelper,
  /NEXT_PUBLIC_ENABLE_ANALYTICS/,
  "analytics helper should support explicit local analytics opt-in",
);

assert.match(
  analyticsHelper,
  /process\.env\.NODE_ENV\s*===\s*["']production["']/,
  "analytics helper should preserve production analytics behavior",
);

assert.match(
  analyticsHelper,
  /function isAnalyticsGloballyEnabled/,
  "analytics helper should separate global analytics enablement from PostHog key availability",
);

assert.match(
  analyticsHelper,
  /isGtmEnabled\(\)[\s\S]*isAnalyticsGloballyEnabled\(\)/,
  "GTM enablement should not depend on the PostHog key",
);

assert.match(
  providers,
  /isAnalyticsEnabled/,
  "providers should gate PostHog initialization and identification with analytics enablement",
);

assert.match(
  analyticsRuntime,
  /isGtmEnabled/,
  "analytics runtime should retain the outer GTM environment gate",
);

assert.doesNotMatch(
  providers,
  /posthog\.identify|UserIdentification/,
  "providers should delegate external-user identification to AnalyticsInit",
);

assert.match(
  analyticsRuntime,
  /if \(!analyticsEnabled[^)]*\)[\s\S]*return;[\s\S]*posthog\.identify\(user\.id,/,
  "analytics runtime should identify the external UUID only when analytics is enabled",
);

assert.match(
  analyticsRuntime,
  /if \(!enabled \|\| !isGtmEnabled\(\)\)[\s\S]*getElementById\(GTM_SCRIPT_ID\)\?\.remove\(\)/,
  "GTM should remain absent or be removed when analytics is disabled",
);

assert.doesNotMatch(
  providers,
  /posthog\.init\(/,
  "providers should delegate PostHog initialization to AnalyticsInit",
);

assert.doesNotMatch(
  rootLayout,
  /PostHogPageView/,
  "root layout should not directly import or render ungated PostHogPageView",
);

assert.match(
  rootLayout,
  /AnalyticsPageView/,
  "root layout should render the gated analytics pageview component",
);

assert.doesNotMatch(
  rootLayout,
  /googletagmanager\.com|<iframe/,
  "root layout should not ship a pre-consent GTM script or iframe",
);

assert.match(providers, /<AnalyticsInit \/>/);

assert.equal(
  existsSync(pageViewPath),
  true,
  "gated AnalyticsPageView component should exist",
);

const pageView = read(pageViewPath);

assert.match(
  pageView,
  /isAnalyticsEnabled/,
  "AnalyticsPageView should retain the outer analytics environment gate",
);

assert.match(
  pageView,
  /posthog\.capture\("\$pageview"/,
  "AnalyticsPageView should preserve PostHog pageview capture when enabled",
);

console.log("Analytics DX regression checks passed");
