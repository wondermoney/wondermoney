import assert from "node:assert/strict";

import { test } from "vitest";

import type { AccountShareMember } from "@/lib/api/account/useAccountShares";

import {
  choicesFor,
  initialSharingState,
  sharesRequest,
  sharingChanged,
} from "./account-sharing";

const member = (
  appuserKey: number,
  role: AccountShareMember["role"],
  overrides: Partial<AccountShareMember> = {},
): AccountShareMember => ({
  appuserKey,
  firstName: `Member ${appuserKey}`,
  lastName: null,
  role,
  isAccountOwner: false,
  share: null,
  access: "hidden",
  ...overrides,
});

const owner = member(3, "owner", { isAccountOwner: true, access: "owner" });
const partner = member(4, "member");
const admin = member(5, "admin");
const viewer = member(6, "viewer");
const members = [owner, partner, admin, viewer];

test("everyone at their maximum shares the account with the household", () => {
  assert.deepEqual(
    sharesRequest(members, {
      isPrivate: true,
      choices: { 4: "write", 5: "write", 6: "read" },
    }),
    { isPrivate: false, shares: [] },
  );
});

test("anything less makes it private, with a share for each member who sees it", () => {
  assert.deepEqual(
    sharesRequest(members, {
      isPrivate: false,
      choices: { 4: "write", 5: "read", 6: "hidden" },
    }),
    {
      isPrivate: true,
      shares: [
        { appuserKey: 4, access: "write" },
        { appuserKey: 5, access: "read" },
      ],
    },
  );
});

test("hiding it from everyone sends private with no shares", () => {
  assert.deepEqual(
    sharesRequest(members, {
      isPrivate: false,
      choices: { 4: "hidden", 5: "hidden", 6: "hidden" },
    }),
    { isPrivate: true, shares: [] },
  );
});

test("the account owner is never in the shares", () => {
  const body = sharesRequest(members, {
    isPrivate: false,
    choices: { 3: "write", 4: "read", 5: "write", 6: "read" },
  });
  assert.equal(
    body.shares.some((share) => share.appuserKey === owner.appuserKey),
    false,
  );
});

test("with nobody else in the household, the toggle alone decides", () => {
  assert.deepEqual(sharesRequest([owner], { isPrivate: true, choices: {} }), {
    isPrivate: true,
    shares: [],
  });
  assert.deepEqual(sharesRequest([owner], { isPrivate: false, choices: {} }), {
    isPrivate: false,
    shares: [],
  });
});

test("a viewer is offered only Hidden and Can view", () => {
  assert.deepEqual(choicesFor(viewer), ["hidden", "read"]);
  assert.deepEqual(choicesFor(partner), ["hidden", "read", "write"]);
  assert.deepEqual(choicesFor(admin), ["hidden", "read", "write"]);
});

test("a shared account starts with everyone at their maximum", () => {
  assert.deepEqual(initialSharingState({ isPrivate: false, members }), {
    isPrivate: false,
    choices: { 4: "write", 5: "write", 6: "read" },
  });
});

test("a private account starts from the stored shares, and a viewer's edit share reads as view", () => {
  assert.deepEqual(
    initialSharingState({
      isPrivate: true,
      members: [
        owner,
        { ...partner, share: "read" },
        admin,
        { ...viewer, share: "write" },
      ],
    }),
    { isPrivate: true, choices: { 4: "read", 5: "hidden", 6: "read" } },
  );
});

test("an untouched control has nothing to save", () => {
  const initial = initialSharingState({ isPrivate: false, members });
  assert.equal(sharingChanged(members, initial, initial), false);
  assert.equal(
    sharingChanged(members, initial, {
      ...initial,
      choices: { ...initial.choices, 6: "hidden" },
    }),
    true,
  );
  assert.equal(
    sharingChanged(
      [owner],
      { isPrivate: false, choices: {} },
      { isPrivate: true, choices: {} },
    ),
    true,
  );
});
