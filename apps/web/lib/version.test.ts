import assert from "node:assert/strict";

import { test } from "vitest";

import { formatBuild, formatVersionInfo, versionsDiffer } from "./version";

test("a build shows its commit beside the version when it has one", () => {
  assert.equal(formatBuild({ commit: "abc1234", version: "1.2.0" }), "1.2.0 (abc1234)");
  assert.equal(formatBuild({ commit: null, version: "dev" }), "dev");
});

test("different release versions are a mismatch", () => {
  assert.equal(versionsDiffer("1.2.0", "1.1.0"), true);
});

test("the same release version is not a mismatch", () => {
  assert.equal(versionsDiffer("1.2.0", "1.2.0"), false);
});

test("a dev build or an unknown server version is never reported as a mismatch", () => {
  assert.equal(versionsDiffer("dev", "1.2.0"), false);
  assert.equal(versionsDiffer("1.2.0", "dev"), false);
  assert.equal(versionsDiffer("1.2.0", null), false);
  assert.equal(versionsDiffer("1.2.0", undefined), false);
});

test("the bug-report line carries both versions and commits on one line", () => {
  assert.equal(
    formatVersionInfo({
      app: { commit: "abc1234", version: "1.2.0" },
      server: { commit: "def5678", version: "1.2.0" },
    }),
    "WonderMoney app 1.2.0 (abc1234), server 1.2.0 (def5678)",
  );
});

test("the bug-report line says when the server version is unknown", () => {
  assert.equal(
    formatVersionInfo({
      app: { commit: "abc1234", version: "1.2.0" },
      server: null,
    }),
    "WonderMoney app 1.2.0 (abc1234), server unknown",
  );
});
