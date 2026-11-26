// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import homeMessages from "../../messages/en/home.json";
import { NoAccountsCard } from "./NoAccountsCard";

const copy = homeMessages.homeOverview.noAccounts;

type Open = { isOpen?: boolean; open?: boolean };

const h = vi.hoisted(() => ({
  accounts: { data: { accounts: [] as unknown[] }, isSuccess: true } as {
    data?: { accounts: unknown[] };
    isSuccess: boolean;
  },
  importAvailable: true,
  viewer: false,
  addModal: null as null | { onAddSyncAccountClick: () => void },
}));

vi.mock("@/lib/api/account/useAccounts", () => ({ default: () => h.accounts }));
vi.mock("@/lib/household/useIsHouseholdViewer", () => ({ useIsHouseholdViewer: () => h.viewer }));
vi.mock("@/components/account/AccountCreateModal", () => ({
  default: (props: Open & { onAddSyncAccountClick: () => void }) => {
    h.addModal = props;
    return props.isOpen ? <div data-testid="add-account" /> : null;
  },
}));
vi.mock("@/components/account/AccountCreateSyncModal", () => ({
  default: (props: Open) => (props.isOpen ? <div data-testid="connect-bank" /> : null),
}));
vi.mock("@/components/account/AccountCreateOfflineModal", () => ({
  default: (props: Open) => (props.isOpen ? <div data-testid="manual-account" /> : null),
}));
vi.mock("@/components/account/StatementImportFlow", () => ({
  useStatementImportAvailable: () => h.importAvailable,
  default: (props: Open) => (props.open ? <div data-testid="statement-import" /> : null),
}));

afterEach(() => {
  cleanup();
  h.accounts = { data: { accounts: [] }, isSuccess: true };
  h.importAvailable = true;
  h.viewer = false;
  h.addModal = null;
});

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={homeMessages}>
      <NoAccountsCard />
    </NextIntlClientProvider>,
  );
}

const option = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

test("a household with no accounts sees the three ways in", () => {
  renderCard();

  screen.getByRole("heading", { name: copy.title });
  option(copy.connect);
  option(copy.import);
  option(copy.manual);
});

test("it is not there once any account exists, nor while the list loads", () => {
  h.accounts = { data: { accounts: [{ accountKey: 1 }] }, isSuccess: true };
  const withAccount = renderCard();
  assert.equal(withAccount.container.innerHTML, "");
  withAccount.unmount();

  h.accounts = { data: undefined, isSuccess: false };
  const loading = renderCard();
  assert.equal(loading.container.innerHTML, "");
});

test("each option opens the flow the app already has", async () => {
  renderCard();

  await userEvent.click(option(copy.connect));
  screen.getByTestId("add-account");
  act(() => h.addModal!.onAddSyncAccountClick());
  screen.getByTestId("connect-bank");

  await userEvent.click(option(copy.import));
  screen.getByTestId("statement-import");

  await userEvent.click(option(copy.manual));
  screen.getByTestId("manual-account");
});

test("an import under way stays open when its new account takes the card away", async () => {
  const view = renderCard();
  await userEvent.click(option(copy.import));

  h.accounts = { data: { accounts: [{ accountKey: 1 }] }, isSuccess: true };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={homeMessages}>
      <NoAccountsCard />
    </NextIntlClientProvider>,
  );

  assert.equal(screen.queryByRole("heading", { name: copy.title }), null);
  screen.getByTestId("statement-import");
});

test("a server that takes no statement files does not offer the import", () => {
  h.importAvailable = false;
  renderCard();

  assert.equal(screen.queryByRole("button", { name: new RegExp(copy.import) }), null);
  option(copy.connect);
  option(copy.manual);
});

test("a household viewer, who cannot add an account, is not offered one", () => {
  h.viewer = true;
  const view = renderCard();

  assert.equal(view.container.innerHTML, "");
});
