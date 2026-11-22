// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { BankConnection } from "@/lib/api/banking/useBankConnections";
import { queryClientWithInstance } from "@/lib/api/instance/instance-fixture";
import { getFirstRunState } from "@/lib/onboarding/firstRunOnboarding";

import commonMessages from "../../../messages/en/common.json";
import onboardingMessages from "../../../messages/en/onboarding.json";
import FirstRunAccountStep from "./FirstRunAccountStep";
import FirstRunSyncStep from "./FirstRunSyncStep";

/*
 * The bank connection funnel can go dark without anything failing: if the
 * step stops emitting, nothing breaks and the funnel just loses its start. So
 * these drive the real steps and check what reaches analytics. How a
 * connection ends is the server's to record (bank_connection_completed or
 * _failed), so coming back sends nothing.
 */

const messages = { ...commonMessages, ...onboardingMessages };

const h = vi.hoisted(() => ({
  capture: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
  requisition: { data: undefined as undefined | { redirectUrl: string }, isError: false, refetch: vi.fn() },
  connections: undefined as undefined | { connections: BankConnection[] },
}));

vi.mock("@/lib/analytics/track", () => ({ track: h.capture }));
vi.mock("next/navigation", () => ({ useSearchParams: () => h.params }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/onboarding/sync",
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: () => {} }),
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => ({ id: "user-1" }) }));
vi.mock("./FirstRunOnboardingRouteShell", () => ({ useFirstRunOnboardingFooter: () => () => {} }));
vi.mock("@/lib/utils/bank-connections-paused", () => ({ isBankConnectionsPaused: () => false }));
vi.mock("@/lib/api/user/useBankLinkCredential", () => ({
  default: () => ({ canLink: true, credentialRequired: false, loading: false, sharedCredentialUnavailable: false }),
}));
vi.mock("@/lib/api/banking/useBankList", () => ({
  default: () => ({ data: [{ id: "BANK_1", name: "Test Bank", logo: "" }], isLoading: false }),
}));
vi.mock("@/components/account/BankList", () => ({
  default: ({ bankList, onClick }: { bankList: { id: string; name: string }[]; onClick: (id: string) => void }) =>
    bankList.map((bank) => (
      <button key={bank.id} type="button" onClick={() => onClick(bank.id)}>
        {bank.name}
      </button>
    )),
}));
vi.mock("@/lib/api/banking/useCreateRequisition", () => ({ default: () => h.requisition }));
vi.mock("@/lib/api/account/useCreateOfflineAccount", () => ({ default: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/lib/api/banking/useBankConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/banking/useBankConnections")>()),
  default: () => ({ data: h.connections }),
}));

const originalLocation = window.location;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

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
  // Leaving for the bank assigns `window.location.href`; keep the test on the page.
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, href: "" } });
  // First-run progress lives in browser storage; give each test a fresh one.
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  h.capture.mockClear();
  h.replace.mockClear();
  h.params = new URLSearchParams();
  h.requisition = { data: undefined, isError: false, refetch: vi.fn() };
  h.connections = undefined;
});

const captured = () => h.capture.mock.calls.map(([name]) => name as string);

function renderStep(step: React.ReactNode) {
  const client = queryClientWithInstance();
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {step}
    </NextIntlClientProvider>,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

test("leaving for the bank records the start of the connection, and nothing before it", async () => {
  const { rerender } = renderStep(<FirstRunAccountStep />);
  await userEvent.click(screen.getByRole("button", { name: "Test Bank" }));
  assert.deepEqual(h.capture.mock.calls, []);

  h.requisition = { ...h.requisition, data: { redirectUrl: "https://bank.example/auth" } };
  rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FirstRunAccountStep />
    </NextIntlClientProvider>,
  );

  await vi.waitFor(() =>
    assert.deepEqual(h.capture.mock.calls, [
      ["bank_connection_started", { provider: "enable_banking" }],
    ]),
  );
  assert.equal(window.location.href, "https://bank.example/auth");
});

function connection(status: BankConnection["status"]): { connections: BankConnection[] } {
  return {
    connections: [
      {
        accessType: "open_banking",
        dataFreshAsOf: null,
        expiresAt: null,
        institutionName: "Test Bank",
        provider: "EnableBanking",
        status,
      },
    ],
  };
}

const syncing = messages.onboarding.firstRun.connect.syncing;

test("coming back from the bank connected moves onboarding on, and sends nothing", async () => {
  h.params = new URLSearchParams({ bankConnection: "success" });
  renderStep(<FirstRunSyncStep />);

  await vi.waitFor(() => assert.equal(getFirstRunState("user-1").accountStep, "connected"));
  assert.deepEqual(h.capture.mock.calls, []);
  // The result leaves the URL so a refresh does not apply it again.
  assert.deepEqual(h.replace.mock.calls, [["/onboarding/sync", { scroll: false }]]);
});

test("the sync step says the import is running until the connection reports it done", () => {
  h.params = new URLSearchParams({ bankConnection: "success" });
  h.connections = connection("processing");
  const { rerender } = renderStep(<FirstRunSyncStep />);
  screen.getByText(syncing.processing);

  h.connections = connection("connected");
  rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FirstRunSyncStep />
    </NextIntlClientProvider>,
  );
  screen.getByText(syncing.succeeded);
});

test("a connection that broke after linking is shown as trouble, not success", () => {
  h.params = new URLSearchParams({ bankConnection: "success" });
  h.connections = connection("error");
  renderStep(<FirstRunSyncStep />);

  screen.getByText(syncing.trouble);
});

test("coming back from the bank without a link shows the error on the account step", () => {
  h.params = new URLSearchParams({ bankConnection: "error" });
  renderStep(<FirstRunAccountStep />);

  screen.getByText(messages.onboarding.firstRun.connect.connectErrorBanner);
  assert.deepEqual(h.capture.mock.calls, []);
});
