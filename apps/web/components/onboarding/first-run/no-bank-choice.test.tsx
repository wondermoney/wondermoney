// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import { queryClientWithInstance } from "@/lib/api/instance/instance-fixture";
import { getFirstRunState } from "@/lib/onboarding/firstRunOnboarding";

import commonMessages from "../../../messages/en/common.json";
import onboardingMessages from "../../../messages/en/onboarding.json";
import FirstRunAccountStep from "./FirstRunAccountStep";

/*
 * Skipping the bank on the account step offers the two ways in that need no
 * bank key, importing a statement and adding an account by hand, before going
 * on without an account. Going on still records the skip, as the old
 * confirmation did; choosing a way in does not.
 */

const messages = { ...commonMessages, ...onboardingMessages };
const copy = messages.onboarding.firstRun;

type ImportFlowProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

const h = vi.hoisted(() => ({
  capture: vi.fn(),
  push: vi.fn(),
  footer: null as ReactNode,
  importAvailable: true,
  importFlow: null as null | ImportFlowProps,
  accounts: [] as { accountKey: number; myAccess?: "owner" | "read" | "write" }[],
}));

vi.mock("@/lib/analytics/track", () => ({ track: h.capture }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/onboarding/account",
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: () => {} }),
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => ({ id: "user-1" }) }));
vi.mock("./FirstRunOnboardingRouteShell", () => ({
  useFirstRunOnboardingFooter: () => (footer: ReactNode) => {
    h.footer = footer;
  },
}));
vi.mock("@/lib/api/user/useBankLinkCredential", () => ({
  default: () => ({ canLink: true, credentialRequired: false, loading: false, sharedCredentialUnavailable: false }),
}));
vi.mock("@/lib/api/banking/useBankList", () => ({ default: () => ({ data: [], isLoading: false }) }));
vi.mock("@/components/account/BankList", () => ({ default: () => null }));
vi.mock("@/lib/api/banking/useCreateRequisition", () => ({
  default: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: h.accounts }, isSuccess: true }),
}));
vi.mock("@/lib/api/account/useCreateOfflineAccount", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/account/StatementImportFlow", () => ({
  useStatementImportAvailable: () => h.importAvailable,
  default: (props: ImportFlowProps) => {
    h.importFlow = props;
    return props.open ? <div data-testid="statement-import" /> : null;
  },
}));

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
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
});

afterEach(() => {
  cleanup();
  h.capture.mockClear();
  h.push.mockClear();
  h.footer = null;
  h.importAvailable = true;
  h.importFlow = null;
  h.accounts = [];
});

function withProviders(node: ReactNode) {
  return (
    <QueryClientProvider client={queryClientWithInstance()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** The shell's footer holds the step's controls; draw what the step last put there. */
async function pressFooter(name: string) {
  const footer = render(withProviders(h.footer));
  await userEvent.click(footer.getByRole("button", { name }));
  footer.unmount();
}

async function skipTheBank() {
  render(withProviders(<FirstRunAccountStep />));
  await pressFooter(copy.skipStep);
}

test("skipping the bank shows the import and manual choices, and records nothing yet", async () => {
  await skipTheBank();

  screen.getByRole("heading", { name: copy.noBank.headline });
  screen.getByRole("button", { name: new RegExp(copy.noBank.import) });
  screen.getByRole("button", { name: new RegExp(copy.noBank.manual) });
  assert.deepEqual(h.capture.mock.calls, []);
  assert.deepEqual(h.push.mock.calls, []);
});

test("going on from the choice records the skip and moves to the sync step", async () => {
  await skipTheBank();
  await pressFooter(copy.noBank.skip);

  assert.deepEqual(h.capture.mock.calls, [["onboarding_step_skipped", { step: "account" }]]);
  assert.equal(getFirstRunState("user-1").accountStep, "skipped");
  assert.deepEqual(h.push.mock.calls, [["/onboarding/sync"]]);
});

test("adding an account by hand opens the manual form, and Back returns to the choice", async () => {
  await skipTheBank();
  await userEvent.click(screen.getByRole("button", { name: new RegExp(copy.noBank.manual) }));

  screen.getByLabelText(copy.connect.manualNameLabel);
  await userEvent.click(screen.getByRole("button", { name: copy.back }));
  screen.getByRole("heading", { name: copy.noBank.headline });
  assert.deepEqual(h.capture.mock.calls, []);
});

test("importing a statement opens the import flow and comes back to the sync step once it imported", async () => {
  await skipTheBank();
  await userEvent.click(screen.getByRole("button", { name: new RegExp(copy.noBank.import) }));
  screen.getByTestId("statement-import");

  h.accounts = [{ accountKey: 1, myAccess: "owner" }];
  act(() => h.importFlow!.onImported());

  assert.equal(getFirstRunState("user-1").accountStep, "manual_added");
  assert.deepEqual(h.push.mock.calls, [["/onboarding/sync"]]);
  assert.deepEqual(h.capture.mock.calls, []);
});

test("leaving the import after it added the account goes on with that account, not a skip", async () => {
  await skipTheBank();
  await userEvent.click(screen.getByRole("button", { name: new RegExp(copy.noBank.import) }));
  h.accounts = [{ accountKey: 1, myAccess: "owner" }];
  act(() => h.importFlow!.onClose());
  assert.equal(screen.queryByTestId("statement-import"), null);

  await pressFooter(copy.noBank.skip);

  assert.deepEqual(h.capture.mock.calls, []);
  assert.equal(getFirstRunState("user-1").accountStep, "manual_added");
  assert.deepEqual(h.push.mock.calls, [["/onboarding/sync"]]);
});

test("a server that takes no statement files offers only the manual account", async () => {
  h.importAvailable = false;
  await skipTheBank();

  assert.equal(screen.queryByRole("button", { name: new RegExp(copy.noBank.import) }), null);
  screen.getByRole("button", { name: new RegExp(copy.noBank.manual) });
});

test("the choice can go back to the bank list", async () => {
  await skipTheBank();
  await userEvent.click(screen.getByRole("button", { name: copy.noBank.connectInstead }));

  screen.getByRole("heading", { name: copy.account.headline });
});

test("an account the import added still counts after going back to the banks and skipping again", async () => {
  await skipTheBank();
  await userEvent.click(screen.getByRole("button", { name: new RegExp(copy.noBank.import) }));
  h.accounts = [{ accountKey: 1, myAccess: "owner" }];
  act(() => h.importFlow!.onClose());

  await userEvent.click(screen.getByRole("button", { name: copy.noBank.connectInstead }));
  screen.getByRole("heading", { name: copy.account.headline });
  await pressFooter(copy.skipStep);
  await pressFooter(copy.noBank.skip);

  assert.deepEqual(h.capture.mock.calls, []);
  assert.equal(getFirstRunState("user-1").accountStep, "manual_added");
  assert.deepEqual(h.push.mock.calls, [["/onboarding/sync"]]);
});

test("an account shared only to view is not one of the person's own: going on is a skip", async () => {
  h.accounts = [{ accountKey: 2, myAccess: "read" }];
  await skipTheBank();
  await pressFooter(copy.noBank.skip);

  assert.deepEqual(h.capture.mock.calls, [["onboarding_step_skipped", { step: "account" }]]);
});
