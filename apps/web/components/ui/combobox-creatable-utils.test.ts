import assert from "node:assert/strict";

import { test } from "vitest";

import { getCreatableQuery } from "./combobox-creatable-utils";

test("returns null for an empty create query", () => {
  assert.equal(getCreatableQuery(""), null);
});

test("returns null for a whitespace-only create query", () => {
  assert.equal(getCreatableQuery("   \t  "), null);
});

test("returns the trimmed create query", () => {
  assert.equal(getCreatableQuery("  Continente  "), "Continente");
});
