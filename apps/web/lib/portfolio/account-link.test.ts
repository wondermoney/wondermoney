import assert from "node:assert/strict";

import { test } from "vitest";

import {
  chooseLinkAccount,
  draftFromLink,
  linkChanged,
  linkInputFromDraft,
  sortLinkableAccounts,
} from "./account-link";

const synced = { accountKey: 1, accountType: "INVESTMENT", source: "open_banking" as const };
const manual = { accountKey: 2, accountType: null, source: "manual" as const };

test("preselects cash only for a bank-synced account and yes for a manual one", () => {
  assert.deepEqual(chooseLinkAccount([synced, manual], 1), { accountId: 1, mode: "cash_only" });
  assert.deepEqual(chooseLinkAccount([synced, manual], 2), { accountId: 2, mode: "includes_holdings" });
});

test("choosing no account unlinks", () => {
  assert.equal(linkInputFromDraft(chooseLinkAccount([synced], null)), null);
});

test("sends a link only when the draft differs from the stored one", () => {
  const stored = { accountKey: 1, accountName: "Broker", mode: "cash_only" as const };
  assert.equal(linkChanged(stored, draftFromLink(stored)), false);
  assert.equal(linkChanged(stored, { accountId: 1, mode: "includes_holdings" }), true);
  assert.equal(linkChanged(null, draftFromLink(null)), false);
  assert.equal(linkChanged(null, { accountId: 2, mode: "includes_holdings" }), true);
});

test("lists investment accounts first", () => {
  assert.deepEqual(sortLinkableAccounts([manual, synced]).map((account) => account.accountKey), [1, 2]);
});
