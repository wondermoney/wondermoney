// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { Account } from "@/lib/api/account/useAccounts";
import type { BudgetVisibility } from "@/lib/budget/visibility";

import budgetMessages from "../../messages/en/budget.json";
import commonMessages from "../../messages/en/common.json";
import BudgetAccountSelectModal from "./BudgetAccountSelectModal";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const messages = { ...commonMessages, ...budgetMessages };

const account = (accountKey: number, accountName: string, isPrivate: boolean) =>
  ({
    accountKey,
    accountName,
    isPrivate,
    accountFinancialInstitutionKey: null,
  }) as Account;

const accounts = [
  account(1, "Joint current", false),
  account(2, "My savings", true),
  account(3, "Groceries card", false),
];

function renderModal(
  visibility: BudgetVisibility,
  linked: number[],
  onAccountsSelected = vi.fn(async () => {}),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BudgetAccountSelectModal
        isOpen
        isLoadingRequisition={false}
        accounts={accounts}
        budgetAccounts={linked.map((accountKey) => ({
          accountKey,
          accountName: String(accountKey),
        }))}
        budgetVisibility={visibility}
        setOpen={() => {}}
        onAccountsSelected={onAccountsSelected}
        onAddSyncAccountClick={() => {}}
        onAddOfflineAccountClick={() => {}}
      />
    </NextIntlClientProvider>,
  );
  return onAccountsSelected;
}

test("a household budget is not offered private accounts, and says why", () => {
  renderModal("household", []);

  assert.ok(screen.getByLabelText("Joint current"));
  assert.ok(screen.getByLabelText("Groceries card"));
  assert.equal(screen.queryByLabelText("My savings"), null);
  assert.ok(
    screen.getByText(budgetMessages.budgetVisibility["private-accounts-excluded"]),
  );
});

test("a personal budget is offered every account, private ones included", () => {
  renderModal("personal", []);

  assert.ok(screen.getByLabelText("Joint current"));
  assert.ok(screen.getByLabelText("My savings"));
  assert.equal(
    screen.queryByText(budgetMessages.budgetVisibility["private-accounts-excluded"]),
    null,
  );
});

test("saving a household budget never sends back a private account it was linked to", async () => {
  const onAccountsSelected = renderModal("household", [2, 3]);

  await userEvent.click(screen.getByLabelText("Joint current"));
  await userEvent.click(screen.getByRole("button", { name: commonMessages.save }));

  await vi.waitFor(() => assert.equal(onAccountsSelected.mock.calls.length, 1));
  assert.deepEqual(onAccountsSelected.mock.calls[0], [[3, 1]]);
});
