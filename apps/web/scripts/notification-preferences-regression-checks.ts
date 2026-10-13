import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const page = read("app/[locale]/(full-layout)/settings/page.tsx");
const component = read("components/settings/Notifications.tsx");

assert.match(
  page,
  /const Notifications = dynamic\([\s\S]*components\/settings\/Notifications/,
  "Notifications should remain a dynamically loaded settings tab",
);
assert.match(
  page,
  /name: "notifications"[\s\S]*label: "navigation\.notifications"[\s\S]*Component: Notifications/,
  "the notifications query parameter should select a real tab",
);
assert.match(
  component,
  /checked=\{preference\.storedEnabled\}/,
  "the switch must show stored preference state, not effective delivery state",
);
assert.match(
  component,
  /buildNotificationPreferencePatch\(stream, nextEnabled\)/,
  "each switch should submit a narrow partial update",
);
assert.match(
  component,
  /!preferencesQuery\.data[\s\S]*preferencesQuery\.isPending[\s\S]*NotificationPreferencesSkeleton[\s\S]*NotificationPreferencesLoadError/,
  "loading and fatal errors should only replace the panel when data is absent",
);
assert.match(
  component,
  /preferencesQuery\.isError[\s\S]*NotificationPreferencesRefreshWarning[\s\S]*rounded-lg border border-border bg-card/,
  "cached controls should remain visible with a non-blocking refetch warning",
);
assert.match(
  component,
  /onRetry=\{\(\) => preferencesQuery\.refetch\(\)\}/,
  "the load error should retry the preferences query",
);
assert.match(
  component,
  /updatePreferences\.mutate\(updatePreferences\.variables\)/,
  "a failed preference update should be retryable with the same narrow payload",
);
assert.doesNotMatch(
  component,
  /aria-label=\{loadingLabel\}/,
  "the loading state should not rely on an aria-label on a generic wrapper",
);
assert.match(
  component,
  /function NotificationPreferencesSkeleton[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*className="sr-only">\{loadingLabel\}/,
  "the visual skeleton should expose translated loading text as a polite status",
);
assert.doesNotMatch(
  component,
  /(?:green|red|blue|slate|gray|violet|amber)-(?:50|[1-9]00)/,
  "notification UI should use semantic theme tokens instead of raw palette utilities",
);
assert.match(
  component,
  /mutate\(\{ marketingOptOut: nextOptedOut \}\)/,
  "the master control should submit a narrow marketingOptOut-only update",
);
assert.match(
  component,
  /checked=\{marketingOptOut\}/,
  "the master switch must reflect the marketingOptOut flag",
);
assert.match(
  component,
  /"budgetAlerts",\s*"weeklyInsights",\s*"growth",\s*"accountRecovery",/,
  "every optional category should be rendered as a toggle",
);

const requiredKeys = [
  "title",
  "description",
  "budgetAlerts.title",
  "budgetAlerts.description",
  "budgetAlerts.detail",
  "weeklyInsights.title",
  "weeklyInsights.description",
  "weeklyInsights.detail",
  "growth.title",
  "growth.description",
  "growth.detail",
  "accountRecovery.title",
  "accountRecovery.description",
  "accountRecovery.detail",
  "marketingOptOut.title",
  "marketingOptOut.description",
  "marketingOptOut.toggleOnLabel",
  "marketingOptOut.toggleOffLabel",
  "dataContext",
  "status.active",
  "status.paused",
  "status.off",
  "pauseReason.delivery",
  "pauseReason.marketingOptOut",
  "pauseReason.generic",
  "toggleOnLabel",
  "toggleOffLabel",
  "loading",
  "loadError.title",
  "loadError.description",
  "refreshWarning.title",
  "refreshWarning.description",
  "retry",
  "saving",
  "saved",
  "saveError",
];

function nested(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

for (const locale of ["en", "pt", "es"]) {
  const common = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;
  const navigation = JSON.parse(
    read(`messages/${locale}/navigation.json`),
  ) as Record<string, unknown>;
  for (const key of requiredKeys) {
    assert.equal(
      typeof nested(common.notificationPreferences, key),
      "string",
      `${locale} is missing notificationPreferences.${key}`,
    );
  }
  assert.equal(
    typeof nested(navigation, "navigation.notifications"),
    "string",
    `${locale} is missing navigation.notifications`,
  );
}

function collectStringLeaves(value: unknown, path: string[] = []): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path: path.join("."), text: value }];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectStringLeaves(child, [...path, key]),
  );
}

const pt = JSON.parse(read("messages/pt/common.json")) as {
  notificationPreferences: Record<string, unknown>;
};
const ptLeaves = collectStringLeaves(pt.notificationPreferences);
const ptCopy = ptLeaves.map((leaf) => leaf.text).join(" ");
for (const phrase of ["80%", "100%", "segunda-feira", "português (Portugal)"]) {
  assert.ok(ptCopy.includes(phrase), `PT-PT copy should include ${phrase}`);
}
// Checked per individual message (not the concatenated blob) so unrelated
// messages sharing common words (e.g. "disponível", "aplicação") can't
// produce a false positive across message boundaries.
for (const leaf of ptLeaves) {
  assert.doesNotMatch(
    leaf.text,
    /aplica(?:ção|cao).*(?:não|nao).*(?:suportad|disponível)/i,
    `copy must not imply that the application itself is unsupported (notificationPreferences.${leaf.path})`,
  );
}

console.log("Notification preference regression checks passed");
