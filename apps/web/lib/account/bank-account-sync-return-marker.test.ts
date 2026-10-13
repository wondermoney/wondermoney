import assert from "node:assert/strict";

import { test } from "vitest";

import {
  clearBankAccountSyncReturnMarker,
  hasActiveBankAccountSyncHandoff,
  hasActiveBankAccountSyncReturnMarker,
  saveBankAccountSyncReturnMarker,
} from "./bank-account-sync-return-marker";

test("bank sync return marker remains best-effort when session storage throws", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: () => {
          throw new Error("storage blocked");
        },
        removeItem: () => {
          throw new Error("storage blocked");
        },
      },
    },
  });

  try {
    assert.doesNotThrow(() => saveBankAccountSyncReturnMarker("/budgets/1"));
    assert.equal(hasActiveBankAccountSyncReturnMarker("/budgets/1"), false);
    assert.doesNotThrow(clearBankAccountSyncReturnMarker);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("bank sync handoff suppression is active only while the marker is fresh", () => {
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => void values.delete(key),
        setItem: (key: string, value: string) => void values.set(key, value),
      },
    },
  });

  try {
    const createdAt = Date.now();
    saveBankAccountSyncReturnMarker("/budgets/1");
    assert.equal(hasActiveBankAccountSyncHandoff(createdAt), true);
    assert.equal(
      hasActiveBankAccountSyncHandoff(createdAt + 31 * 60 * 1000),
      false,
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
