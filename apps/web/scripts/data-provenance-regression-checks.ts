/*
 * Guards DESIGN_HISTORY.md rule 6 — data states when it is from.
 *
 * The subtle rule is in `getAggregateFreshness`: a total summed from several
 * accounts is only as current as its **stalest** component, so the reported
 * timestamp is the oldest sync, not the newest. Reporting the newest is the
 * flattering answer and the wrong one, and it is the kind of thing a later
 * refactor "simplifies" into `Math.max`.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { getAggregateFreshness } from "../lib/account/accounts-freshness";

type TestAccount = Parameters<typeof getAggregateFreshness>[0];

const account = (over: Record<string, unknown> = {}) =>
  ({
    accountKey: 1,
    name: "Test",
    balance: 0,
    syncStatus: null,
    refreshedAt: null,
    ...over,
  }) as unknown as NonNullable<TestAccount>[number];

// --- Nothing to say --------------------------------------------------------

assert.equal(getAggregateFreshness(undefined), null, "undefined → null");
assert.equal(getAggregateFreshness([]), null, "no accounts → null");
assert.equal(
  getAggregateFreshness([account(), account()]),
  null,
  "All-manual accounts carry no sync time, so there is no honest 'as of' to print — the caller must render nothing rather than invent one.",
);
assert.equal(
  getAggregateFreshness([account({ refreshedAt: "not-a-date" })]),
  null,
  "An unparseable timestamp must be discarded, not rendered as Invalid Date.",
);

// --- The oldest wins, not the newest ---------------------------------------

const older = "2026-08-14T09:00:00.000Z";
const newer = "2026-08-20T09:00:00.000Z";

const mixed = getAggregateFreshness([
  account({ syncStatus: { lastSyncedAt: newer, staleness: "fresh" } }),
  account({ syncStatus: { lastSyncedAt: older, staleness: "stale" } }),
  account(), // manual — excluded, must not drag the count
]);

assert.ok(mixed, "A set with synced accounts must report freshness.");
assert.equal(
  mixed.oldestSyncedAt.toISOString(),
  older,
  "A total is only as fresh as its stalest component: report the OLDEST sync, never the newest.",
);
assert.equal(
  mixed.syncedCount,
  2,
  "Manual accounts contribute no timestamp and must not be counted as synced.",
);
assert.equal(mixed.isStale, true, "A stale member marks the aggregate stale.");
assert.equal(mixed.hasError, false, "No member is in error here.");

// --- refreshedAt is the fallback when there is no structured status --------

const legacy = getAggregateFreshness([account({ refreshedAt: older })]);
assert.ok(legacy, "refreshedAt alone is still a sync time.");
assert.equal(legacy.oldestSyncedAt.toISOString(), older);

// --- Error state -----------------------------------------------------------

const broken = getAggregateFreshness([
  account({ syncStatus: { lastSyncedAt: newer, staleness: "error" } }),
]);
assert.equal(
  broken?.hasError,
  true,
  "A broken connection must surface, so the caller can say so instead of showing a confident timestamp.",
);

// --- The component ---------------------------------------------------------

const provenance = readFileSync("components/ui/DataProvenance.tsx", "utf8");

assert.ok(
  /if \(!hasValidDate && !scope\) return null;/.test(provenance),
  "DataProvenance must render nothing when there is nothing honest to say.",
);
assert.ok(
  /locale: getDateFnsLocale\(locale\)/.test(provenance),
  "Relative times must be localised — date-fns defaults to English, which is how every 'x hours ago' in this app rendered in English for pt and es readers.",
);

// --- No relative time anywhere may skip the locale -------------------------

for (const file of [
  "components/account/AccountSyncBadge.tsx",
  "components/account/TransactionActivity.tsx",
  "components/ui/DataProvenance.tsx",
]) {
  const source = readFileSync(file, "utf8");
  const calls = source.match(/formatDistanceToNow\([\s\S]*?\)\s*\}/g) ?? [];
  for (const call of calls) {
    assert.ok(
      /locale:/.test(call),
      `${file}: formatDistanceToNow must be passed a locale — without one it renders English for every reader.`,
    );
  }
}

console.log("Data provenance regression checks passed");
