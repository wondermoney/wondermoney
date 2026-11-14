import assert from "node:assert/strict";

import { test } from "vitest";

import type { AccountOwnershipMember } from "@/lib/api/account/useAccountOwnership";

import {
  basisPointsOf,
  initialOwnershipState,
  ownershipChanged,
  ownershipRequest,
  ownershipTotal,
} from "./account-ownership";

const member = (
  appuserKey: number,
  overrides: Partial<AccountOwnershipMember> = {},
): AccountOwnershipMember => ({
  appuserKey,
  canSee: true,
  displayName: `Member ${appuserKey}`,
  firstName: `Member ${appuserKey}`,
  isAccountOwner: false,
  lastName: null,
  percent: 0,
  role: "member",
  ...overrides,
});

const owner = member(1, { isAccountOwner: true });
const partner = member(2);
const kid = member(3);

test("reads a percentage with up to two decimals, a comma or a point, and nothing else", () => {
  assert.equal(basisPointsOf("60"), 6000);
  assert.equal(basisPointsOf("33.33"), 3333);
  assert.equal(basisPointsOf("12,5"), 1250);
  assert.equal(basisPointsOf(""), 0);
  assert.equal(basisPointsOf("33.333"), null);
  assert.equal(basisPointsOf("100.01"), null);
  assert.equal(basisPointsOf("-5"), null);
  assert.equal(basisPointsOf("abc"), null);
});

test("starts a split account from its shares, and offers the owner 100% or a joint account an even split", () => {
  const split = initialOwnershipState({
    isJoint: false,
    isSplit: true,
    members: [
      { ...owner, percent: 60 },
      { ...partner, percent: 40 },
    ],
  });
  assert.deepEqual(split, { percents: { 1: "60", 2: "40" }, split: true });

  assert.deepEqual(
    initialOwnershipState({
      isJoint: false,
      isSplit: false,
      members: [owner, partner],
    }),
    { percents: { 1: "100", 2: "0" }, split: false },
  );
  assert.deepEqual(
    initialOwnershipState({
      isJoint: true,
      isSplit: false,
      members: [owner, partner, kid],
    }),
    { percents: { 1: "33.34", 2: "33.33", 3: "33.33" }, split: false },
  );
});

test("leaves out a member who cannot see the account", () => {
  const hidden = member(4, { canSee: false });
  const state = initialOwnershipState({
    isJoint: true,
    isSplit: false,
    members: [owner, hidden],
  });

  assert.deepEqual(state.percents, { 1: "100" });
});

test("sends the shares only when they add up to 100%, leaving members at 0% out", () => {
  const members = [owner, partner, kid];

  assert.deepEqual(
    ownershipRequest(members, {
      percents: { 1: "60", 2: "40", 3: "" },
      split: true,
    }),
    {
      body: [
        { appuserKey: 1, percent: 60 },
        { appuserKey: 2, percent: 40 },
      ],
      ok: true,
    },
  );
  assert.deepEqual(
    ownershipRequest(members, {
      percents: { 1: "60", 2: "30", 3: "0" },
      split: true,
    }),
    { error: "total", ok: false },
  );
  assert.deepEqual(
    ownershipRequest(members, {
      percents: { 1: "60", 2: "39.999", 3: "0" },
      split: true,
    }),
    { error: "invalid", ok: false },
  );
  assert.equal(
    ownershipTotal(members, { percents: { 1: "60", 2: "30.5" }, split: true }),
    9050,
  );
});

test("stops splitting with an empty list", () => {
  assert.deepEqual(
    ownershipRequest([owner, partner], { percents: { 1: "1" }, split: false }),
    { body: [], ok: true },
  );
});

test("notices a change only in what would be saved", () => {
  const members = [owner, partner];
  const start = { percents: { 1: "60", 2: "40" }, split: true };

  assert.equal(
    ownershipChanged(members, start, {
      ...start,
      percents: { 1: "60.00", 2: "40" },
    }),
    false,
  );
  assert.equal(
    ownershipChanged(members, start, {
      ...start,
      percents: { 1: "50", 2: "50" },
    }),
    true,
  );
  assert.equal(
    ownershipChanged(members, start, { ...start, split: false }),
    true,
  );
  const off = { percents: { 1: "100", 2: "0" }, split: false };
  assert.equal(
    ownershipChanged(members, off, { ...off, percents: { 1: "50", 2: "50" } }),
    false,
  );
});
