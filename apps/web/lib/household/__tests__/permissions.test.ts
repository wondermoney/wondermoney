import assert from "node:assert/strict";

import { test } from "vitest";

import type {
  Household,
  HouseholdMember,
  HouseholdRole,
} from "@/lib/api/household/types";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

import { householdErrorKey } from "../error-messages";
import { joinPath, signInToAcceptHref } from "../join-links";
import {
  canChangeRole,
  canInvite,
  canLeave,
  canManageInvite,
  canRemoveMember,
  canTransferOwnership,
  findMe,
  grantableRoles,
  roleChangeOptions,
  seatsRemaining,
} from "../permissions";

const ROLES: HouseholdRole[] = ["owner", "admin", "member", "viewer"];

const person = (appuserKey: number, role: HouseholdRole): HouseholdMember => ({
  appuserKey,
  emailAddress: `${role}${appuserKey}@x.test`,
  role,
});

const household = (overrides: Partial<Household> = {}): Household => ({
  maxMembers: 6,
  members: [person(1, "owner"), person(2, "admin")],
  pendingInvites: [],
  viewerAppuserKey: 1,
  ...overrides,
});

test("a manager grants only the roles strictly below their own, never owner", () => {
  assert.deepEqual(grantableRoles("owner"), ["admin", "member", "viewer"]);
  assert.deepEqual(grantableRoles("admin"), ["member", "viewer"]);
  assert.deepEqual(grantableRoles("member"), []);
  assert.deepEqual(grantableRoles("viewer"), []);
  assert.deepEqual(grantableRoles(undefined), []);
});

test("a manager acts on someone else only when that person ranks below them", () => {
  // [actor, target, allowed]
  const expected: Record<HouseholdRole, HouseholdRole[]> = {
    admin: ["member", "viewer"],
    member: [],
    owner: ["admin", "member", "viewer"],
    viewer: [],
  };
  for (const actorRole of ROLES) {
    const me = person(1, actorRole);
    for (const targetRole of ROLES) {
      const target = person(2, targetRole);
      const allowed = expected[actorRole].includes(targetRole);
      assert.equal(canChangeRole(me, target), allowed, `${actorRole} changes ${targetRole}`);
      assert.equal(canRemoveMember(me, target), allowed, `${actorRole} removes ${targetRole}`);
    }
  }
});

test("nobody changes their own role or removes themself", () => {
  for (const role of ROLES) {
    const me = person(1, role);
    assert.equal(canChangeRole(me, me), false);
    assert.equal(canRemoveMember(me, me), false);
    assert.equal(canTransferOwnership(me, me), false);
  }
  assert.equal(canChangeRole(undefined, person(2, "viewer")), false);
  assert.equal(canRemoveMember(undefined, person(2, "viewer")), false);
});

test("a role change offers what the caller may grant", () => {
  assert.deepEqual(roleChangeOptions(person(1, "admin"), person(2, "viewer")), [
    "member",
    "viewer",
  ]);
  assert.deepEqual(roleChangeOptions(person(1, "owner"), person(2, "admin")), [
    "admin",
    "member",
    "viewer",
  ]);
  assert.deepEqual(roleChangeOptions(person(1, "admin"), person(2, "admin")), []);
});

test("only the owner transfers ownership, to anyone else", () => {
  for (const target of ["admin", "member", "viewer"] as const) {
    assert.equal(canTransferOwnership(person(1, "owner"), person(2, target)), true);
    assert.equal(canTransferOwnership(person(1, "admin"), person(2, target)), false);
  }
});

test("everyone but the owner may leave", () => {
  assert.equal(canLeave(person(1, "owner")), false);
  for (const role of ["admin", "member", "viewer"] as const) {
    assert.equal(canLeave(person(1, role)), true);
  }
  assert.equal(canLeave(undefined), false);
});

test("invites are resent or revoked only by a manager above the invite's role", () => {
  assert.equal(canManageInvite("owner", "admin"), true);
  assert.equal(canManageInvite("admin", "admin"), false);
  assert.equal(canManageInvite("admin", "viewer"), true);
  assert.equal(canManageInvite("member", "viewer"), false);
});

test("members and pending invites both take a place; inviting needs a manager and a place", () => {
  const withInvite = household({
    maxMembers: 3,
    pendingInvites: [
      { email: "x@x.test", expiresAt: "", householdInviteKey: 1, role: "member" },
    ],
  });
  assert.equal(seatsRemaining(withInvite), 0);
  assert.equal(canInvite("owner", withInvite), false);
  assert.equal(seatsRemaining(household()), 4);
  assert.equal(canInvite("owner", household()), true);
  assert.equal(canInvite("admin", household()), true);
  assert.equal(canInvite("member", household()), false);
  assert.equal(canInvite("viewer", household()), false);
});

test("finds the caller by viewerAppuserKey, else by email", () => {
  assert.equal(findMe(household({ viewerAppuserKey: 2 }), "owner1@x.test")?.appuserKey, 2);
  assert.equal(findMe(household({ viewerAppuserKey: null }), "OWNER1@x.test")?.appuserKey, 1);
  assert.equal(findMe(household({ viewerAppuserKey: null }), undefined), undefined);
});

test("maps household refusals to their message keys and nothing else", () => {
  const refusal = (code: string) => ({ response: { data: { code }, status: 409 } });
  for (const code of [
    "household_full",
    "household_role_required",
    "already_household_member",
    "household_has_data",
    "household_has_members",
    "invite_email_mismatch",
    "invite_expired",
    "invite_invalid",
    "invite_already_used",
  ]) {
    assert.equal(householdErrorKey(refusal(code)), code);
  }
  assert.equal(householdErrorKey(refusal("not_found")), undefined);
  assert.equal(householdErrorKey(new Error("network")), undefined);
});

test("signing in to accept comes back to the invite on the same locale", () => {
  assert.equal(joinPath("pt", "a b"), "/pt/join?token=a%20b");
  assert.deepEqual(signInToAcceptHref("es", "tok"), {
    pathname: "/auth/login",
    query: { next: "/es/join?token=tok" },
  });
  // The login form only follows a `next` it accepts.
  assert.equal(
    getSafeNextPath(joinPath("en", "tok"), "https://app.test"),
    "/en/join?token=tok",
  );
});
