import { strict as assert } from "node:assert";

import { test } from "vitest";

import { isInstanceAdminEmail } from "./access";

test("allows wonder.money domain emails", () => {
  assert.equal(isInstanceAdminEmail("admin@wonder.money", "2026-07-15T00:00:00.000Z", "@wonder.money"), true);
  assert.equal(isInstanceAdminEmail("ADMIN@WONDER.MONEY", "2026-07-15T00:00:00.000Z", "@wonder.money"), true);
});

test("rejects unverified wonder.money emails", () => {
  assert.equal(isInstanceAdminEmail("admin@wonder.money", null, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail("admin@wonder.money", undefined, "@wonder.money"), false);
});

test("rejects non-wonder.money emails and lookalike domains", () => {
  const confirmedAt = "2026-07-15T00:00:00.000Z";
  assert.equal(isInstanceAdminEmail("user@example.com", confirmedAt, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail("user@notwonder.money", confirmedAt, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail("user@wonder.money.evil.com", confirmedAt, "@wonder.money"), false);
});

test("rejects missing or malformed emails", () => {
  assert.equal(isInstanceAdminEmail(undefined, undefined, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail(null, undefined, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail("", undefined, "@wonder.money"), false);
  assert.equal(isInstanceAdminEmail("wonder.money", undefined, "@wonder.money"), false);
});

test("has no admins on an instance without an admin domain", () => {
  assert.equal(isInstanceAdminEmail("admin@wonder.money", "2026-07-15T00:00:00.000Z", null), false);
});
