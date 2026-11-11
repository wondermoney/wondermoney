// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { Account } from "@/lib/api/account/useAccounts";

import commonMessages from "../../messages/en/common.json";
import AccountsList from "./AccountsList";

const reorder = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/lib/api/account/useAccounts", () => ({
  useReorderAccounts: () => ({
    isPending: false,
    mutateAsync: reorder.mutateAsync,
  }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("@/i18n/navigation", () => ({
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
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("./AccountEditSheet", () => ({ default: () => null }));
vi.mock("./AccountDeleteModal", () => ({ default: () => null }));

afterEach(cleanup);

const account = (fields: Partial<Account>): Account => ({
  accountKey: 1,
  accountName: "Current",
  accountFinancialInstitutionKey: null,
  balance: 1000,
  currencyKey: { code: "EUR" },
  appuserCurrencyBalance: 1000,
  accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
  refreshedAt: null,
  source: "manual",
  csvImportFormat: "generic",
  isPrivate: false,
  isOwnedByViewer: true,
  ownerFirstName: null,
  availableBalance: null,
  appuserCurrencyAvailableBalance: null,
  syncStatus: null,
  fxStatus: "exact",
  fxRateDate: null,
  ...fields,
});

function renderList(accounts: Account[], reordering = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <AccountsList accounts={accounts} reordering={reordering} />
    </NextIntlClientProvider>,
  );
}

test("an account in a currency with no rate shows its own balance, marked not converted, and the total says why it is missing", () => {
  const { container } = renderList([
    account({}),
    account({
      accountKey: 2,
      accountName: "Yen savings",
      balance: 10000,
      currencyKey: { code: "JPY" as Account["currencyKey"]["code"] },
      appuserCurrencyBalance: null,
      fxStatus: "missing",
    }),
  ]);

  const text = container.textContent ?? "";
  assert.match(text, /¥10,000/);
  assert.ok(screen.getByRole("button", { name: /^Not converted\./ }));
  assert.match(text, /Unavailable — some balances are missing/);

  fireEvent.click(
    screen.getByRole("button", { name: "Not every amount could be converted" }),
  );
  assert.match(
    screen.getByRole("note").textContent ?? "",
    /No exchange rate yet for JPY\./,
  );
});

test("an account converted at an old rate is marked estimated and still counts in the total", () => {
  const { container } = renderList([
    account({}),
    account({
      accountKey: 2,
      accountName: "Dollar account",
      balance: 100,
      currencyKey: { code: "USD" },
      appuserCurrencyBalance: 90,
      fxStatus: "provisional",
      fxRateDate: "2026-01-15",
    }),
  ]);

  assert.match(
    screen
      .getByRole("button", { name: /^Estimated\./ })
      .getAttribute("aria-label") ?? "",
    /Jan 15, 2026/,
  );
  assert.match(container.textContent ?? "", /€1,090\.00/);
});

test("accounts converted exactly are not marked", () => {
  renderList([account({})]);

  assert.equal(
    screen.queryByRole("button", { name: /Not converted|Estimated/ }),
    null,
  );
  assert.equal(
    screen.queryByRole("button", {
      name: "Not every amount could be converted",
    }),
    null,
  );
});

test("reorder mode moves an account with the arrow buttons and saves the new order", async () => {
  reorder.mutateAsync.mockReset();
  reorder.mutateAsync.mockResolvedValue(undefined);
  renderList(
    [
      account({ accountKey: 1, accountName: "Alpha" }),
      account({ accountKey: 2, accountName: "Beta" }),
      account({ accountKey: 3, accountName: "Gamma" }),
    ],
    true,
  );

  assert.match(screen.getByText(/Drag an account/).textContent ?? "", /order/);
  assert.ok(screen.getByRole("button", { name: "Drag to reorder Beta" }));

  fireEvent.click(screen.getByRole("button", { name: "Move Beta up" }));

  await waitFor(() =>
    assert.deepEqual(reorder.mutateAsync.mock.calls[0], [[2, 1, 3]]),
  );
  assert.deepEqual(
    screen
      .getAllByRole("button", { name: /^Drag to reorder/ })
      .map((node) => node.getAttribute("aria-label")),
    ["Drag to reorder Beta", "Drag to reorder Alpha", "Drag to reorder Gamma"],
  );
});

test("reorder mode cannot move the first account up or the last one down", () => {
  renderList(
    [
      account({ accountKey: 1, accountName: "Alpha" }),
      account({ accountKey: 2, accountName: "Beta" }),
    ],
    true,
  );

  assert.equal(
    screen.getByRole("button", { name: "Move Alpha up" }).hasAttribute("disabled"),
    true,
  );
  assert.equal(
    screen.getByRole("button", { name: "Move Beta down" }).hasAttribute("disabled"),
    true,
  );
});

