// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import { ACTIVATION_EVENTS } from "@/lib/analytics";
import type { BankConnection } from "@/lib/api/banking/useBankConnections";
import { FIRST_RUN_EVENTS, getFirstRunState } from "@/lib/onboarding/firstRunOnboarding";

import commonMessages from "../../../messages/en/common.json";
import onboardingMessages from "../../../messages/en/onboarding.json";
import FirstRunAccountStep from "./FirstRunAccountStep";
import FirstRunSyncStep from "./FirstRunSyncStep";

/*
 * The first-run connect funnel can go dark without anything failing: if the
 * steps stop emitting, nothing breaks and the activation funnel just loses
 * its middle. So these drive the real steps and check what reaches PostHog.
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

vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: h.capture }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => h.params }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/onboarding/sync",
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: () => {} }),
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => ({ id: "user-1" }) }));
vi.mock("./FirstRunOnboardingRouteShell", () => ({ useFirstRunOnboardingFooter: () => () => {} }));
vi.mock("@/lib/utils/bank-connections-paused", () => ({ isBankConnectionsPaused: () => false }));
vi.mock("@/lib/api/user/useEnableBankingCredential", () => ({
  default: () => ({ data: { status: "active" }, isLoading: false }),
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
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {step}
    </NextIntlClientProvider>,
  );
}

test("picking a bank, getting a requisition and leaving for the bank are each recorded", async () => {
  const { rerender } = renderStep(<FirstRunAccountStep />);

  await userEvent.click(screen.getByRole("button", { name: "Test Bank" }));
  assert.deepEqual(captured(), [FIRST_RUN_EVENTS.accountConnectClicked]);

  h.requisition = { ...h.requisition, data: { redirectUrl: "https://bank.example/auth" } };
  rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FirstRunAccountStep />
    </NextIntlClientProvider>,
  );

  await vi.waitFor(() =>
    assert.deepEqual(
      [...captured()].sort(),
      [
        FIRST_RUN_EVENTS.accountBeforeRedirect,
        FIRST_RUN_EVENTS.accountConnectClicked,
        FIRST_RUN_EVENTS.accountRequisitionCreated,
      ].sort(),
    ),
  );
  assert.equal(window.location.href, "https://bank.example/auth");
});

test("a requisition that fails is recorded, so retrying it is not silent", async () => {
  const { rerender } = renderStep(<FirstRunAccountStep />);
  await userEvent.click(screen.getByRole("button", { name: "Test Bank" }));

  h.requisition = { ...h.requisition, isError: true };
  rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FirstRunAccountStep />
    </NextIntlClientProvider>,
  );

  await vi.waitFor(() => assert.ok(captured().includes(FIRST_RUN_EVENTS.accountRequisitionFailed)));
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

test("coming back from the bank connected records the return and the first account", async () => {
  h.params = new URLSearchParams({ bankConnection: "success" });
  renderStep(<FirstRunSyncStep />);

  await vi.waitFor(() => assert.ok(captured().includes(ACTIVATION_EVENTS.firstAccountAdded)));
  assert.deepEqual(h.capture.mock.calls.find(([name]) => name === FIRST_RUN_EVENTS.accountConnectReturned)?.[1], {
    outcome: "connected",
  });
  assert.equal(getFirstRunState("user-1").accountStep, "connected");
  // The result leaves the URL so a refresh does not record it again.
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

test("coming back from the bank without a link shows the error on the account step and records it", async () => {
  h.params = new URLSearchParams({ bankConnection: "error" });
  renderStep(<FirstRunAccountStep />);

  screen.getByText(messages.onboarding.firstRun.connect.connectErrorBanner);
  await vi.waitFor(() => assert.ok(captured().includes(FIRST_RUN_EVENTS.accountConnectReturned)));
  assert.deepEqual(h.capture.mock.calls.find(([name]) => name === FIRST_RUN_EVENTS.accountConnectReturned)?.[1], {
    outcome: "error",
  });
  assert.equal(captured().includes(ACTIVATION_EVENTS.firstAccountAdded), false);
});
