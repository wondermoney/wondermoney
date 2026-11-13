// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { ExpenseGroup } from "@/lib/api/expense-group/types";

import enCommon from "../../messages/en/common.json";
import enExpenseGroups from "../../messages/en/expense-groups.json";
import enTransactions from "../../messages/en/transactions.json";
import { ExpenseGroupDetail } from "./ExpenseGroupDetail";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/api/api", () => ({ default: apiMock }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: never }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const viewer = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/household/useIsHouseholdViewer", () => ({
  useIsHouseholdViewer: () => viewer.value,
}));

afterEach(cleanup);

beforeAll(() => {
  // DrawerDialog picks a dialog on wide screens.
  window.matchMedia ??= (query: string) =>
    ({
      addEventListener() {},
      matches: true,
      media: query,
      removeEventListener() {},
    }) as unknown as MediaQueryList;
});

const trip: ExpenseGroup = {
  expenseGroupKey: 4,
  name: "Lisbon trip",
  currencyCode: "EUR",
  archived: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  members: [
    {
      expenseGroupMemberKey: 1,
      name: "Ana",
      email: null,
      appuserKey: 10,
      isHouseholdMember: true,
      isYou: true,
      position: 0,
    },
  ],
  yourBalances: [],
};

let group: ExpenseGroup;

beforeEach(() => {
  vi.clearAllMocks();
  viewer.value = false;
  group = trip;
  apiMock.get.mockImplementation(async (url: string) => {
    switch (url) {
      case "/v1/expense-groups/4":
        return { data: { group } };
      case "/v1/expense-groups/4/balances":
        return { data: { currencies: [] } };
      case "/v1/expense-groups/4/shares":
        return { data: { expenses: [] } };
      case "/v1/expense-groups/4/settlements":
        return { data: { settlements: [] } };
      case "/v1/account/currencies":
        return {
          data: {
            currencies: [
              { currencyKey: 1, code: "EUR", description: "Euro" },
              { currencyKey: 2, code: "USD", description: "US dollar" },
            ],
          },
        };
      case "/v1/household":
        return { data: { members: [], invites: [] } };
      default:
        throw new Error(`unexpected GET ${url}`);
    }
  });
});

function renderDetail() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions, ...enExpenseGroups }}
      >
        <ExpenseGroupDetail groupId={4} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("a writer renames the group, and the page shows the saved name", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementation(async (_url: string, body: object) => {
    group = { ...group, ...body };
    return { data: { group } };
  });
  renderDetail();

  await screen.findByRole("heading", { name: "Lisbon trip" });
  await user.click(screen.getByRole("button", { name: "Edit group" }));

  const dialog = await screen.findByRole("dialog", { name: "Edit group" });
  const name = screen.getByRole("textbox", {
    name: "Name",
  }) as HTMLInputElement;
  assert.ok(dialog.contains(name));
  await user.clear(name);
  await user.type(name, "Porto trip");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.deepEqual(apiMock.patch.mock.calls[0], [
      "/v1/expense-groups/4",
      { name: "Porto trip" },
    ]),
  );
  // The group is fetched again, as after every group write.
  await screen.findByRole("heading", { name: "Porto trip" });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
});

test("a household viewer gets no edit action", async () => {
  viewer.value = true;
  renderDetail();

  await screen.findByRole("heading", { name: "Lisbon trip" });
  assert.equal(screen.queryByRole("button", { name: "Edit group" }), null);
});
