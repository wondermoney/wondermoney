import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsPage = readFileSync(
  "app/[locale]/(full-layout)/settings/page.tsx",
  "utf8",
);

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert.match(
  settingsPage,
  /from "next\/dynamic"/,
  "settings page should use next/dynamic for non-default tabs",
);

for (const importName of [
  "Appearance",
  "Assistant",
  "Billing",
  "UserCategoriesTable",
  "Connections",
  "Notifications",
  "Referrals",
  "Security",
]) {
  assert.doesNotMatch(
    settingsPage,
    new RegExp(`import\\s+${importName}\\s+from`),
    `settings page should not statically import heavy tab ${importName}`,
  );
}

assert.match(
  settingsPage,
  /Component:/,
  "settings tab metadata should store component references instead of JSX instances",
);

assert.doesNotMatch(
  settingsPage,
  /content:\s*</,
  "settings tab metadata should not create tab JSX eagerly",
);

// `visibleTabs` until the assistant stopped being gated by admin email — there
// is no hidden subset any more, so the list is just `tabs`. Same requirement:
// one panel shell per tab, or Radix loses the trigger/panel pairing.
assert.match(
  settingsPage,
  /tabs\.map\(\(tab\) => \([\s\S]*<TabsContent/s,
  "settings page should keep one tab panel shell per tab for Radix accessibility",
);

assert.match(
  settingsPage,
  /tab\.name === selectedTab \? <SelectedComponent \/> : null/,
  "settings page should only instantiate selected tab content inside the mapped tab panels",
);

assert.match(
  settingsPage,
  /selectedTabConfig\?\.Component/,
  "settings page should render only the selected tab component",
);

console.log("Settings DX regression checks passed");
