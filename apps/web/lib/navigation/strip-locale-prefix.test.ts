import assert from "node:assert/strict";

import { test } from "vitest";

import { stripLocalePrefix } from "./strip-locale-prefix";

test("strips every configured locale", () => {
  assert.equal(stripLocalePrefix("/en/settings"), "/settings");
  assert.equal(stripLocalePrefix("/pt/settings"), "/settings");
  assert.equal(stripLocalePrefix("/es/accounts/transactions"), "/accounts/transactions");
});

test("the bare locale root becomes /", () => {
  assert.equal(stripLocalePrefix("/en"), "/");
  assert.equal(stripLocalePrefix("/pt"), "/");
});

test("keeps query strings and hashes attached", () => {
  assert.equal(stripLocalePrefix("/en/settings?tab=security"), "/settings?tab=security");
  assert.equal(stripLocalePrefix("/en?tab=security"), "/?tab=security");
  assert.equal(stripLocalePrefix("/en/accounts#recent"), "/accounts#recent");
});

test("leaves an already-unlocalised path alone", () => {
  assert.equal(stripLocalePrefix("/settings"), "/settings");
  assert.equal(stripLocalePrefix("/"), "/");
});

test("does not eat a first segment that merely starts with a locale", () => {
  // The bug this guards against is over-eager prefix matching: "entries" and
  // "esconder" begin with "en" and "es" but are not locales.
  assert.equal(stripLocalePrefix("/entries"), "/entries");
  assert.equal(stripLocalePrefix("/esconder/x"), "/esconder/x");
  assert.equal(stripLocalePrefix("/english"), "/english");
});

test("strips only one locale segment, so a doubled path still resolves", () => {
  assert.equal(stripLocalePrefix("/en/en/settings"), "/en/settings");
});

test("passes through anything that is not an absolute path", () => {
  assert.equal(stripLocalePrefix("https://example.com/en/x"), "https://example.com/en/x");
  assert.equal(stripLocalePrefix(""), "");
  assert.equal(stripLocalePrefix("settings"), "settings");
});
