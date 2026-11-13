// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { SimplefinBankConnection } from "@/lib/api/banking/useBankConnections";

import enCommon from "../../../messages/en/common.json";
import SimplefinConnectionsTable from "./SimplefinConnectionsTable";

const state = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: { delete: state.delete, get: state.get, post: vi.fn() },
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.delete.mockReset();
  state.get.mockReset();
});

const m = enCommon.simplefin;

function connection(
  overrides: Partial<SimplefinBankConnection> = {},
): SimplefinBankConnection {
  return {
    accessType: "open_banking",
    bankId: null,
    connectionId: 7,
    dataFreshAsOf: "2026-11-12T10:00:00.000Z",
    daysUntilExpiry: null,
    expiresAt: null,
    institutionName: "Example Credit Union",
    lastError: null,
    provider: "SimpleFIN",
    status: "connected",
    ...overrides,
  };
}

function renderTable(connections: SimplefinBankConnection[]) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
        <SimplefinConnectionsTable connections={connections} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("names a connection without an institution SimpleFIN, and offers no reconnect", () => {
  renderTable([connection({ institutionName: null })]);

  const row = screen.getAllByRole("row")[1]!;
  within(row).getByText(m.name);
  within(row).getByText(m.status.connected);
  assert.equal(
    within(row).queryByRole("button", { name: enCommon.reconnect }) === null,
    true,
  );
});

test("says a revoked access needs a new setup token", () => {
  renderTable([connection({ status: "revoked" })]);

  screen.getByText(m.status.revoked);
  screen.getByText(m["revoked-help"]);
});

test("reads sync history from SimpleFIN's own route", async () => {
  state.get.mockResolvedValue({ data: { syncs: [] } });
  renderTable([connection()]);

  await userEvent
    .setup()
    .click(
      screen.getByRole("button", { name: enCommon["bank-sync"].history.action }),
    );

  await waitFor(() =>
    assert.deepEqual(state.get.mock.calls.map(([url]) => url), [
      "/v1/banking/simplefin/connections/7/syncs",
    ]),
  );
});

test("disconnects through SimpleFIN's own route after confirming", async () => {
  state.delete.mockResolvedValue({ data: undefined });
  renderTable([connection()]);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: m.disconnect }));
  const dialog = await screen.findByRole("alertdialog");
  within(dialog).getByText(m["disconnect-title"]);
  assert.equal(state.delete.mock.calls.length, 0);

  await user.click(within(dialog).getByRole("button", { name: m.disconnect }));

  await waitFor(() =>
    assert.deepEqual(state.delete.mock.calls.map(([url]) => url), [
      "/v1/banking/simplefin/connections/7",
    ]),
  );
});
