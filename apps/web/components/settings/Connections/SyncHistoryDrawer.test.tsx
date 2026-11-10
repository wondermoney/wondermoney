// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { BankSyncHistoryRun } from "@/lib/api/banking/useBankSyncHistory";

import enCommon from "../../../messages/en/common.json";
import SyncHistoryDrawer from "./SyncHistoryDrawer";

const state = vi.hoisted(() => ({
  runs: [] as BankSyncHistoryRun[],
  isLoading: false,
  isError: false,
}));

vi.mock("@/lib/api/banking/useBankSyncHistory", () => ({
  default: () => ({
    data: state.isLoading || state.isError ? undefined : { syncs: state.runs },
    isError: state.isError,
    isLoading: state.isLoading,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.runs = [];
  state.isLoading = false;
  state.isError = false;
});

function renderDrawer() {
  render(
    <NextIntlClientProvider locale="en" messages={enCommon}>
      <SyncHistoryDrawer
        open
        onOpenChange={() => {}}
        connectionId={42}
        institutionName="Real Bank"
      />
    </NextIntlClientProvider>,
  );
}

const m = enCommon["bank-sync"];

test("shows each run's outcome, and a failure in plain words with the action that helps", () => {
  state.runs = [
    {
      accounts: 3,
      errorCode: null,
      finishedAt: "2026-07-21T10:05:00.000Z",
      flow: "scheduled-refresh",
      result: "full_success",
      retryAt: null,
      rowsCreated: 12,
      startedAt: "2026-07-21T10:00:00.000Z",
    },
    {
      accounts: 2,
      errorCode: "consent_expired",
      finishedAt: "2026-07-20T10:05:00.000Z",
      flow: "initial-add",
      result: "failed",
      retryAt: null,
      rowsCreated: null,
      startedAt: "2026-07-20T10:00:00.000Z",
    },
  ];
  renderDrawer();

  screen.getByText(m.history.result.full_success);
  screen.getByText(m.history.result.failed);
  screen.getByText(m.errors["consent-expired"]);
  screen.getByText(m.actions.reconnect);
  screen.getByText("3 accounts");
  screen.getByText("12 new transactions");
});

test("a rate-limited run says the bank limited the frequency and when the next attempt is due", () => {
  state.runs = [
    {
      accounts: 2,
      errorCode: "rate_limited",
      finishedAt: "2026-07-21T10:05:00.000Z",
      flow: "scheduled-refresh",
      result: "failed",
      retryAt: "2026-07-21T11:05:00.000Z",
      rowsCreated: null,
      startedAt: "2026-07-21T10:00:00.000Z",
    },
  ];
  renderDrawer();

  screen.getByText(m.errors["rate-limited"]);
  assert.match(screen.getByText(/Next attempt/).textContent ?? "", /Next attempt/);
});

test("says so when the connection has no runs yet", () => {
  renderDrawer();
  screen.getByText(m.history.empty);
});
