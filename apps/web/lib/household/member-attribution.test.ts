import assert from "node:assert/strict";

import { test } from "vitest";

import type { HouseholdMember } from "@/lib/api/household/types";

import {
  memberDisplayName,
  memberFilterParam,
  memberInitials,
  memberKeysFor,
  parseMemberFilter,
  resolveMemberFilter,
} from "./member-attribution";

const member = (appuserKey: number): HouseholdMember => ({
  appuserKey,
  emailAddress: `member${appuserKey}@example.com`,
  firstName: null,
  role: "member",
});

test("a filter round-trips through the URL, and anything else is everyone", () => {
  assert.equal(parseMemberFilter("7"), 7);
  assert.equal(parseMemberFilter("shared"), "shared");
  for (const value of [null, undefined, "", "0", "-3", "7.5", "abc", "SHARED"]) {
    assert.equal(parseMemberFilter(value), null, String(value));
  }
  assert.equal(memberFilterParam(7), "7");
  assert.equal(memberFilterParam("shared"), "shared");
  assert.equal(memberFilterParam(null), undefined);
});

test("a request filters by one member key, or sends no filter for everyone", () => {
  assert.deepEqual(memberKeysFor(7), ["7"]);
  assert.deepEqual(memberKeysFor("shared"), ["shared"]);
  assert.equal(memberKeysFor(null), undefined);
});

test("a filter survives only while it names someone in a household of more than one", () => {
  const two = [member(1), member(2)];
  assert.equal(resolveMemberFilter(2, two), 2);
  assert.equal(resolveMemberFilter("shared", two), "shared");
  assert.equal(resolveMemberFilter(9, two), null);
  assert.equal(resolveMemberFilter(1, [member(1)]), null);
  assert.equal(resolveMemberFilter("shared", [member(1)]), null);
});

test("a member is named by their first name, else their email", () => {
  assert.equal(
    memberDisplayName({ firstName: " Ana ", emailAddress: "ana@example.com" }),
    "Ana",
  );
  assert.equal(
    memberDisplayName({ firstName: "  ", emailAddress: "rui@example.com" }),
    "rui@example.com",
  );
  assert.equal(
    memberDisplayName({ firstName: null, emailAddress: "rui@example.com" }),
    "rui@example.com",
  );
});

test("initials take the first and last words of a name, or an email's first letter", () => {
  assert.equal(memberInitials("Ana"), "A");
  assert.equal(memberInitials("ana maria sousa"), "AS");
  assert.equal(memberInitials("rui@example.com"), "R");
  assert.equal(memberInitials("  "), "?");
});
