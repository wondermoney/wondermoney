// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { getFirstRunState, patchFirstRunState } from "@/lib/onboarding/firstRunOnboarding";

import FirstRunOnboardingRedirectGate from "./FirstRunOnboardingRedirectGate";

const h = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: h.replace }),
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => ({ id: "user-1" }) }));
// The bank connection created the user's first accounts before redirecting.
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [{ accountKey: 1 }] }, isFetched: true }),
}));
vi.mock("@/lib/api/user/useCompleteVersionedOnboarding", () => ({
  useOnboardingBootstrap: () => ({ data: { onboarding: { completed: false } }, isSuccess: true }),
}));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

beforeEach(() => {
  // First-run progress lives in browser storage; give each test a fresh one.
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
  patchFirstRunState({ status: "in_progress", currentStep: "account" }, "user-1");
});
afterEach(() => {
  cleanup();
  h.replace.mockClear();
  window.history.replaceState(null, "", "/");
});

function renderGateAt(url: string) {
  window.history.replaceState(null, "", url);
  render(
    <FirstRunOnboardingRedirectGate>
      <p>page</p>
    </FirstRunOnboardingRedirectGate>,
  );
}

test("landing back from the bank mid-onboarding leaves the first run open for its sync step", () => {
  renderGateAt("/en/settings?tab=bank-provider&enableBankingConnection=success");

  assert.equal(getFirstRunState("user-1").status, "in_progress");
  assert.equal(h.replace.mock.calls.length, 0);
});

test("outside that return, having accounts still finishes the first run", () => {
  renderGateAt("/en/settings");

  assert.equal(getFirstRunState("user-1").status, "completed");
});
