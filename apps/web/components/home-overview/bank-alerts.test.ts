import assert from "node:assert/strict";

import { test } from "vitest";

import type { BankingAlert } from "@/lib/api/banking/useBankingAlerts";

import {
  nextDismissedBankAlertIds,
  parseDismissedBankAlertIds,
  pickVisibleBankAlerts,
} from "./bank-alerts";

const alert = (overrides: Partial<BankingAlert> & Pick<BankingAlert, "id" | "kind">): BankingAlert => ({
  institutionName: "Millennium BCP",
  bankId: "BCP",
  expiresAt: null,
  daysUntilExpiry: null,
  failingSince: null,
  ...overrides,
});

const ids = (alerts: BankingAlert[]) => alerts.map((a) => a.id);

test("orders by urgency: access ended, then fewest days left, then the longest failing streak", () => {
  const alerts = [
    alert({ id: "sync-new", kind: "sync_failing", failingSince: "2026-11-06T00:00:00Z" }),
    alert({ id: "expiring-7", kind: "consent_expiring", daysUntilExpiry: 7 }),
    alert({ id: "sync-old", kind: "sync_failing", failingSince: "2026-11-01T00:00:00Z" }),
    alert({ id: "revoked", kind: "consent_revoked" }),
    alert({ id: "expiring-1", kind: "consent_expiring", daysUntilExpiry: 1 }),
  ];

  assert.deepEqual(ids(pickVisibleBankAlerts(alerts, new Set())), [
    "revoked",
    "expiring-1",
    "expiring-7",
    "sync-old",
    "sync-new",
  ]);
});

test("hides dismissed ids, and a new episode id of the same connection shows again", () => {
  const alerts = [
    alert({ id: "bcp-expiring-1d", kind: "consent_expiring", daysUntilExpiry: 1 }),
    alert({ id: "cgd-sync", kind: "sync_failing" }),
  ];

  assert.deepEqual(
    ids(pickVisibleBankAlerts(alerts, new Set(["bcp-expiring-7d", "cgd-sync"]))),
    ["bcp-expiring-1d"],
  );
  assert.deepEqual(
    pickVisibleBankAlerts(alerts, new Set(["bcp-expiring-1d", "cgd-sync"])),
    [],
  );
});

test("does not reorder or mutate the input", () => {
  const alerts = [
    alert({ id: "b", kind: "sync_failing" }),
    alert({ id: "a", kind: "consent_revoked" }),
  ];
  pickVisibleBankAlerts(alerts, new Set());
  assert.deepEqual(ids(alerts), ["b", "a"]);
});

test("missing days or dates sort after known ones within a kind", () => {
  const alerts = [
    alert({ id: "unknown", kind: "consent_expiring" }),
    alert({ id: "known", kind: "consent_expiring", daysUntilExpiry: 3 }),
    alert({ id: "no-date", kind: "sync_failing" }),
    alert({ id: "dated", kind: "sync_failing", failingSince: "2026-11-01T00:00:00Z" }),
  ];
  assert.deepEqual(ids(pickVisibleBankAlerts(alerts, new Set())), [
    "known",
    "unknown",
    "dated",
    "no-date",
  ]);
});

test("a malformed stored value reads as nothing dismissed", () => {
  assert.deepEqual(parseDismissedBankAlertIds(null), []);
  assert.deepEqual(parseDismissedBankAlertIds("not json"), []);
  assert.deepEqual(parseDismissedBankAlertIds('{"a":1}'), []);
  assert.deepEqual(parseDismissedBankAlertIds('["a", 2, "b"]'), ["a", "b"]);
});

test("storing a dismissal keeps only ids the API still returns", () => {
  assert.deepEqual(
    nextDismissedBankAlertIds(["ended", "still-open"], ["new"], ["still-open", "new"]),
    ["still-open", "new"],
  );
  assert.deepEqual(nextDismissedBankAlertIds(["a"], ["a"], ["a"]), ["a"]);
});
