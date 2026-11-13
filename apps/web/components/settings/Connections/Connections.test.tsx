// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { BankConnection } from "@/lib/api/banking/useBankConnections";
import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import { profileQueryKey } from "@/lib/api/user/useProfile";

import enCommon from "../../../messages/en/common.json";
import Connections from "./Connections";

/*
 * Settings → Bank connections, starting empty: connecting SimpleFIN from the Add account dialog
 * swaps the empty state for the connections table as soon as the new connection is listed. The
 * connect flow has to finish anyway, and the account lists have to refresh once the first sync
 * has brought the accounts in.
 */

const server = vi.hoisted(() => ({
  accountsFetches: 0,
  connections: [] as BankConnection[],
  post: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: {
    delete: vi.fn(),
    get: (url: string) => {
      if (url === "/v1/user/user-1/requisitions")
        return Promise.resolve({ data: { requisitions: [] } });
      if (url === "/v1/banking/connections")
        return Promise.resolve({ data: { connections: server.connections } });
      if (url === "/v1/user/enable-banking-credential")
        return Promise.resolve({ data: null });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    },
    post: server.post,
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: server.toastSuccess },
}));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ id: "user-1" }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/settings",
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));
// The Enable Banking and manual-account dialogs are not part of this flow.
vi.mock("@/components/account/AccountCreateSyncModal", () => ({
  default: () => null,
}));
vi.mock("@/components/account/AccountCreateOfflineModal", () => ({
  default: () => null,
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
  server.accountsFetches = 0;
  server.connections = [];
  server.post.mockReset();
  server.toastSuccess.mockReset();
});

const m = enCommon.simplefin;
// A synthetic setup token: base64 of a made-up claim URL, built here so no token-shaped literal is committed.
const TOKEN = btoa("https://bridge.simplefin.org/simplefin/claim/TEST");

function simplefin(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    accessType: "open_banking",
    accounts: [],
    bankId: null,
    connectionId: 7,
    dataFreshAsOf: null,
    daysUntilExpiry: null,
    expiresAt: null,
    institutionName: "Example Credit Union",
    lastError: null,
    provider: "SimpleFIN",
    status: "processing",
    ...overrides,
  };
}

/** Stands in for any account list on the page: it counts how often accounts are read. */
function AccountsProbe() {
  useQuery({
    queryKey: ["accounts"],
    queryFn: () => {
      server.accountsFetches += 1;
      return { accounts: [] };
    },
  });
  return null;
}

function renderSettings() {
  const client = queryClientWithInstance(
    instanceFeatures({ bankSyncProviders: ["enable_banking", "simplefin"] }),
  );
  client.setQueryData(profileQueryKey, { bankSyncCredentials: "instance" });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
        <Connections />
        <AccountsProbe />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("connecting SimpleFIN from an empty Settings page finishes, and the account lists refresh after the first sync", async () => {
  server.post.mockImplementation(async () => {
    server.connections = [simplefin()];
    return { data: { connectionId: 7, incidentId: "incident-1" } };
  });
  renderSettings();
  const user = userEvent.setup();

  await screen.findByText(enCommon["no-connections"]);
  await user.click(screen.getByRole("button", { name: enCommon["add-account"] }));
  await user.click(await screen.findByRole("button", { name: m.connect }));
  await user.click(await screen.findByLabelText(m["token-label"]));
  await user.paste(TOKEN);
  await user.click(screen.getByRole("button", { name: m.submit }));

  // The new connection replaced the empty state, and the dialog still finished: it said so and
  // closed.
  await screen.findByText(m["connections-title"]);
  await waitFor(() =>
    assert.deepEqual(server.toastSuccess.mock.calls, [[m.success]]),
  );
  assert.equal(screen.queryByLabelText(m["token-label"]) === null, true);
  const readsBeforeFirstSync = server.accountsFetches;

  server.connections = [
    simplefin({
      accounts: [{ accountKey: 11, accountName: "Everyday checking" }],
      dataFreshAsOf: "2026-11-13T09:00:00.000Z",
      status: "connected",
    }),
  ];

  await screen.findByText("Everyday checking", undefined, { timeout: 5000 });
  await waitFor(() =>
    assert.equal(server.accountsFetches, readsBeforeFirstSync + 1),
  );
});
