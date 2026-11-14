// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import commonMessages from "../../messages/en/common.json";
import transactionsMessages from "../../messages/en/transactions.json";
import AccountTransactionsTable from "./AccountTransactionsTable";

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {} }),
}));
// Desktop: the table with its actions column (the phone list renders beside it in jsdom).
vi.mock("@/lib/utils/useTailwindBreakpoints", () => ({
  useBreakpoint: () => true,
}));
// No network: a query the table or its inspector starts stays pending.
vi.mock("@/lib/api/api", () => {
  const pending = () => new Promise(() => {});
  return {
    default: {
      get: pending,
      post: pending,
      put: pending,
      patch: pending,
      delete: pending,
    },
    getApiUrl: () => "http://api.test",
  };
});
vi.mock("@/lib/api/tag/useTags", () => ({
  default: () => ({ data: { tags: [] } }),
}));
vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({ data: { categories: [] }, isLoading: false }),
}));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const row = (
  transactionKey: number,
  accountKey: number,
  description: string,
): Transaction =>
  ({
    transactionKey,
    transactionDate: "2026-11-02T10:00:00.000Z",
    accountKey: {
      accountKey,
      accountName: `Account ${accountKey}`,
      currencyKey: { code: "EUR" },
    },
    settlementAmount: -12,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -12,
    appuserCurrencyKey: { code: "EUR" },
    balance: 0,
    appuserCurrencyBalance: 0,
    appuserTransactionCategories: [],
    description,
    descriptionDirty: description.toUpperCase(),
    reviewed: true,
    hidden: false,
    fxStatus: "exact",
  }) as Transaction;

function renderTable(readOnlyAccountKeys?: ReadonlySet<number>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...commonMessages, ...transactionsMessages }}
      >
        <AccountTransactionsTable
          transactions={[row(1, 3, "Groceries"), row(2, 4, "Rent")]}
          categories={[]}
          withFilters={false}
          withPagination={false}
          withSelectRow
          withMultiSelectRow
          readOnlyAccountKeys={readOnlyAccountKeys}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The desktop table's row for a description (the phone list renders the same rows too). */
const tableRow = (description: string): HTMLElement => {
  const tr = screen
    .getAllByText(description)
    .map((node) => node.closest("tr"))
    .find((node) => node !== null);
  assert.ok(tr, `no table row for ${description}`);
  return tr;
};

describe("rows of an account shared to view only", () => {
  test("every row keeps its actions when the person may change every account", () => {
    renderTable();

    for (const description of ["Groceries", "Rent"]) {
      const tr = tableRow(description);
      assert.ok(within(tr).getByRole("button", { name: "Open menu" }));
      assert.equal(
        within(tr).getByRole("checkbox").hasAttribute("disabled"),
        false,
      );
    }
  });

  test("a view-only row has no menu, no category picker and cannot be selected", () => {
    renderTable(new Set([4]));

    const editable = tableRow("Groceries");
    assert.ok(within(editable).getByRole("button", { name: "Open menu" }));

    const viewOnly = tableRow("Rent");
    assert.equal(
      within(viewOnly).queryByRole("button", { name: "Open menu" }),
      null,
    );
    assert.equal(within(viewOnly).queryByRole("combobox"), null);
    assert.equal(
      within(viewOnly).getByRole("checkbox").hasAttribute("disabled"),
      true,
    );
  });

  test("the inspector of a view-only row offers no edit", () => {
    renderTable(new Set([4]));
    fireEvent.click(tableRow("Rent"));
    assert.equal(screen.queryByRole("button", { name: "Edit" }), null);
  });

  test("the inspector of an editable row still offers edit", () => {
    renderTable(new Set([4]));
    fireEvent.click(tableRow("Groceries"));
    assert.ok(screen.getByRole("button", { name: "Edit" }));
  });
});
