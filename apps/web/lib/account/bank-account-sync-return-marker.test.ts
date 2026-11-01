import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import {
  consumeBankConnectionReturnTarget,
  parseBankConnectionReturnPage,
  saveBankAccountSyncReturnMarker,
} from "./bank-account-sync-return-marker";

const originalWindow = globalThis.window;

function stubSessionStorage(storage: Partial<Storage>) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });
}

function memorySessionStorage() {
  const values = new Map<string, string>();
  stubSessionStorage({
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

test("the pages the app saves come back as return targets", () => {
  assert.deepEqual(parseBankConnectionReturnPage("accounts"), {
    kind: "accounts",
  });
  assert.deepEqual(parseBankConnectionReturnPage("pt/onboarding/sync"), {
    kind: "onboarding",
    locale: "pt",
  });
  assert.deepEqual(parseBankConnectionReturnPage("/budgets/12/2026/3"), {
    kind: "budget",
    pathname: "/budgets/12/2026/3",
  });
});

test("anything else is not a return target", () => {
  for (const page of [
    "https://evil.example/accounts",
    "//evil.example",
    "/accounts?next=https://evil.example",
    "/settings",
    "xx/onboarding/sync",
    "/budgets/12/../../logout",
    "/budgets/abc/2026",
    "",
  ]) {
    assert.equal(parseBankConnectionReturnPage(page), null, page);
  }
});

test("a saved marker is returned once, then gone", () => {
  memorySessionStorage();
  saveBankAccountSyncReturnMarker("accounts");

  assert.deepEqual(consumeBankConnectionReturnTarget(), { kind: "accounts" });
  assert.equal(consumeBankConnectionReturnTarget(), null);
});

test("a marker older than half an hour is dropped", () => {
  memorySessionStorage();
  const savedAt = Date.now();
  saveBankAccountSyncReturnMarker("accounts");

  assert.equal(consumeBankConnectionReturnTarget(savedAt + 31 * 60 * 1000), null);
});

test("blocked session storage never throws", () => {
  const blocked = () => {
    throw new Error("storage blocked");
  };
  stubSessionStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });

  assert.doesNotThrow(() => saveBankAccountSyncReturnMarker("accounts"));
  assert.equal(consumeBankConnectionReturnTarget(), null);
});
