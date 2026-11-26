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
  credentialRequired: false,
  credentialEnabled: undefined as boolean | undefined,
  simplefin: false,
  instanceKnown: true,
  wizard: null as null | { entry?: string; onChooseBank: () => void },
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
vi.mock("@/lib/api/user/useBankLinkCredential", () => ({
  default: ({ enabled }: { enabled?: boolean } = {}) => {
    h.credentialEnabled = enabled;
    return { credentialRequired: h.credentialRequired };
  },
}));
vi.mock("@/lib/api/instance/useInstance", () => ({ useFeature: () => true, useInstanceKnown: () => h.instanceKnown }));
vi.mock("@/components/settings/Connections/SimplefinConnectButton", () => ({ useSimplefinAvailable: () => h.simplefin }));
vi.mock("@/components/settings/BankProvider/EnableBankingSetupWizard", () => ({
  default: (props: Open & { entry: string; onChooseBank: () => void }) => {
    h.wizard = props;
    return props.open ? <div data-testid="setup-wizard" /> : null;
  },
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
  h.credentialRequired = false;
  h.credentialEnabled = undefined;
  h.simplefin = false;
  h.instanceKnown = true;
  h.wizard = null;
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

test("without a key, Connect a bank opens the setup wizard, which goes on to the bank list", async () => {
  h.credentialRequired = true;
  renderCard();

  await userEvent.click(option(copy.connect));
  screen.getByTestId("setup-wizard");
  assert.equal(screen.queryByTestId("add-account"), null);
  assert.equal(h.wizard?.entry, "home_card");
  act(() => h.wizard!.onChooseBank());
  screen.getByTestId("connect-bank");
});

test("without a key on a server that also offers SimpleFIN, Connect a bank opens the add-account dialog", async () => {
  h.credentialRequired = true;
  h.simplefin = true;
  renderCard();

  await userEvent.click(option(copy.connect));
  screen.getByTestId("add-account");
  assert.equal(screen.queryByTestId("setup-wizard"), null);
});

test("before the server has said which bank providers it has, Connect a bank waits for the answer", async () => {
  h.credentialRequired = true;
  h.instanceKnown = false;
  const view = renderCard();

  await userEvent.click(option(copy.connect));
  assert.equal(screen.queryByTestId("setup-wizard"), null);
  assert.equal(screen.queryByTestId("add-account"), null);

  h.instanceKnown = true;
  view.rerender(
    <NextIntlClientProvider locale="en" messages={homeMessages}>
      <NoAccountsCard />
    </NextIntlClientProvider>,
  );
  screen.getByTestId("setup-wizard");
});

test("the key is asked about only while the card shows", () => {
  renderCard();
  assert.equal(h.credentialEnabled, true);
  cleanup();

  h.accounts = { data: { accounts: [{ accountKey: 1 }] }, isSuccess: true };
  renderCard();
  assert.equal(h.credentialEnabled, false);
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
