// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import {
  instanceFeatures,
  queryClientWithInstance,
} from "@/lib/api/instance/instance-fixture";
import { readPrivacyMode, writePrivacyMode } from "@/lib/privacy/privacy-mode-store";

import enCommandPalette from "../../messages/en/command-palette.json";
import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import ptCommandPalette from "../../messages/pt/command-palette.json";
import ptCommon from "../../messages/pt/common.json";
import ptNavigation from "../../messages/pt/navigation.json";
import { closeCommandPalette, openCommandPalette } from "./command-palette-store";
import CommandPalette from "./CommandPalette";

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
const route = vi.hoisted(() => ({ pathname: "/" }));
const themeMock = vi.hoisted(() => ({
  resolvedTheme: "light",
  setTheme: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => routerMock,
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {}, reset: () => {} }),
}));
vi.mock("next-themes", () => ({ useTheme: () => themeMock }));
vi.mock("@/lib/api/preview-features/usePreviewFeatures", () => ({
  usePreviewFeatures: () => false,
}));

// The shell-level action dialogs are stubbed: the palette test asserts the
// palette drives their isOpen, not their internals (those have their own tests).
vi.mock("@/components/account/AccountTransactionAddModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="account-transaction-add-modal" /> : null,
}));
vi.mock("@/components/account/AccountTransactionImportModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="account-transaction-import-modal" /> : null,
}));
vi.mock("@/components/account/AccountCreateModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="account-add-modal" /> : null,
}));
vi.mock("@/components/account/AccountCreateSyncModal", () => ({
  default: () => null,
}));
vi.mock("@/components/account/AccountCreateOfflineModal", () => ({
  default: () => null,
}));
vi.mock("@/components/goals/GoalCreateDialog", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="goal-create-dialog" /> : null,
}));

beforeAll(() => {
  // jsdom lacks the layout APIs Radix and cmdk call.
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

beforeEach(() => {
  route.pathname = "/";
  routerMock.push.mockReset();
  themeMock.setTheme.mockReset();
  themeMock.resolvedTheme = "light";
});

afterEach(() => {
  closeCommandPalette();
  writePrivacyMode(false);
  cleanup();
});

const locales = [
  {
    locale: "en",
    messages: { ...enCommon, ...enNavigation, ...enCommandPalette },
  },
  {
    locale: "pt",
    messages: { ...ptCommon, ...ptNavigation, ...ptCommandPalette },
  },
] as const;

function seededClient(
  features: ReturnType<typeof instanceFeatures> = instanceFeatures(),
) {
  const client = queryClientWithInstance(features);
  client.setQueryData(["accounts"], {
    accounts: [{ accountKey: 7, accountName: "Chase Checking" }],
  });
  client.setQueryData(["budgets-full"], {
    budgets: [{ budgetKey: 3, name: "Household budget" }],
  });
  client.setQueryData(["goals", {}], {
    goals: [{ goalKey: 11, name: "Emergency fund" }],
  });
  client.setQueryData(["portfolios"], {
    portfolios: [{ portfolioKey: 5, name: "Brokerage" }],
  });
  client.setQueryData(["loans"], { loans: [{ loanKey: 9, name: "Car loan" }] });
  return client;
}

function renderPalette(client: QueryClient = seededClient(), localeIndex = 0) {
  const { locale, messages } = locales[localeIndex];
  const onError = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        onError={onError}
      >
        <input data-testid="outside-field" aria-label="outside field" />
        <button
          type="button"
          data-testid="trigger"
          onClick={(event) => openCommandPalette(event.currentTarget)}
        >
          trigger
        </button>
        <CommandPalette />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onError };
}

function openWithHotkey(modifier: "metaKey" | "ctrlKey" = "metaKey") {
  fireEvent.keyDown(document.body, { code: "KeyK", key: "k", [modifier]: true });
  return screen.getByRole("dialog");
}

function typeInPalette(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  return input;
}

test("Cmd+K opens the palette as a labelled, modal dialog focused on its search input", () => {
  const { onError } = renderPalette();
  assert.equal(screen.queryByRole("dialog"), null);

  const dialog = openWithHotkey("metaKey");

  assert.equal(dialog.getAttribute("aria-modal"), "true");
  const titleId = dialog.getAttribute("aria-labelledby");
  assert.ok(titleId, "the dialog must be labelled");
  assert.equal(
    document.getElementById(titleId)?.textContent,
    enCommandPalette["command-palette"].title,
  );
  assert.equal(document.activeElement, screen.getByRole("combobox"));
  assert.ok(screen.getByRole("listbox"));
  assert.ok(screen.getAllByRole("option").length > 0);
  assert.equal(onError.mock.calls.length, 0, String(onError.mock.calls[0]?.[0]));
});

test("Ctrl+K opens the palette too, and again while open it closes it", () => {
  renderPalette();
  openWithHotkey("ctrlKey");
  assert.ok(screen.getByRole("dialog"));

  // The palette's own input captures keys, but the hotkey still toggles there.
  fireEvent.keyDown(screen.getByRole("combobox"), {
    code: "KeyK",
    key: "k",
    ctrlKey: true,
  });
  assert.equal(screen.queryByRole("dialog"), null);
});

test("the hotkey does not fire while typing in a text field outside the palette", () => {
  renderPalette();
  const field = screen.getByTestId("outside-field");
  field.focus();
  fireEvent.keyDown(field, { code: "KeyK", key: "k", metaKey: true });
  assert.equal(screen.queryByRole("dialog"), null);
});

test("Escape closes the palette and focus returns to the trigger button", async () => {
  renderPalette();
  const trigger = screen.getByTestId("trigger");
  await userEvent.click(trigger);
  assert.ok(screen.getByRole("dialog"));

  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.equal(document.activeElement, trigger);
});

test("arrow keys move the selection and Enter navigates, closing the palette", () => {
  renderPalette();
  openWithHotkey();
  const input = screen.getByRole("combobox");
  const listbox = screen.getByRole("listbox");

  const home = within(listbox).getByRole("option", {
    name: enNavigation.navigation.home,
  });
  assert.equal(home.getAttribute("aria-selected"), "true");

  fireEvent.keyDown(input, { key: "ArrowDown" });
  const accounts = within(listbox).getByRole("option", {
    name: enNavigation.navigation.accounts,
  });
  assert.equal(accounts.getAttribute("aria-selected"), "true");

  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(routerMock.push.mock.calls, [["/accounts"]]);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("every sidebar destination and settings tab is reachable from the palette", () => {
  renderPalette();
  const dialog = openWithHotkey();
  const listbox = within(dialog).getByRole("listbox");
  const nav = enNavigation.navigation;

  for (const label of [
    nav.home,
    nav.accounts,
    nav.loans,
    nav.budgets,
    nav.portfolio,
    nav.assets,
    nav["financial-markets"],
    nav.goals,
    nav.reports,
    nav["bills-subscriptions"],
    nav.explorer,
    nav.watchlist,
    enCommon.settings,
    nav.profile,
    nav.notifications,
  ]) {
    within(listbox).getByRole("option", { name: label });
  }
  // "Overview" and "Transactions" each exist under two sections.
  for (const label of [nav.overview, nav.transactions]) {
    assert.equal(
      within(listbox).getAllByRole("option", { name: label }).length,
      2,
    );
  }
});

test("selecting an account from the cached data opens it", () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("chase");

  const option = screen.getByRole("option", { name: "Chase Checking" });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  assert.ok(option);
  assert.deepEqual(routerMock.push.mock.calls, [["/accounts/7"]]);
});

test("in pt, English keywords still match the localized labels", () => {
  renderPalette(seededClient(), 1);
  openWithHotkey();
  typeInPalette("budgets");

  within(screen.getByRole("listbox")).getByRole("option", {
    name: ptNavigation.navigation.budgets,
  });

  typeInPalette("household");
  within(screen.getByRole("listbox")).getByRole("option", {
    name: "Household budget",
  });
});

test("a search with no matches shows the designed empty state", () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("zzzz-nothing");

  assert.ok(
    screen.getByText(enCommandPalette["command-palette"].empty),
  );
});

test("while the cached data hydrates, the loading state shows", () => {
  // A client with only /v1/instance: every entity query is still pending.
  renderPalette(queryClientWithInstance());
  openWithHotkey();

  assert.ok(screen.getByText(enCommandPalette["command-palette"].loading));
});

test("a server without file storage hides the import action", () => {
  renderPalette(seededClient(instanceFeatures({ fileStorage: false })));
  openWithHotkey();
  typeInPalette("import");

  assert.equal(
    screen.queryByRole("option", { name: enCommon["import-transactions"] }),
    null,
  );
});

test("the add-transaction action opens the same dialog the accounts page opens", async () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("add transaction");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

  await waitFor(() =>
    assert.ok(screen.getByTestId("account-transaction-add-modal")),
  );
  assert.equal(screen.queryByRole("dialog"), null);
});

test("the create-budget action routes to the wizard, like its button", () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("create budget");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

  assert.deepEqual(routerMock.push.mock.calls, [["/budgets/wizard"]]);
});

test("a settings tab action routes to /settings?tab=…", () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("notifications");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

  assert.deepEqual(routerMock.push.mock.calls, [["/settings?tab=notifications"]]);
});

test("the theme action toggles the theme through next-themes", () => {
  renderPalette();
  openWithHotkey();
  typeInPalette("dark");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

  assert.deepEqual(themeMock.setTheme.mock.calls, [["dark"]]);
});

test("the privacy-mode action flips privacy mode", () => {
  renderPalette();
  assert.equal(readPrivacyMode(), false);
  openWithHotkey();
  typeInPalette("hide amounts");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

  assert.equal(readPrivacyMode(), true);
});
