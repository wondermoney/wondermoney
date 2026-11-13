// @vitest-environment jsdom
/**
 * The accounts overview's spending by category follows the member filter (issue #337): the
 * section carries the filter control, and its request sends the URL's member as `memberKeys`.
 * A household of one has no control and no filter, whatever the URL says.
 */
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { GetTransactionsCategorySpendingRequest } from "@/lib/api/account/useTransactionsCategorySpending";
import type { Household, HouseholdMember } from "@/lib/api/household/types";

import enCategories from "../../messages/en/categories.json";
import enCommon from "../../messages/en/common.json";
import enHousehold from "../../messages/en/household.json";
import AccountsCategorySpending from "./AccountsCategorySpending";

const state = vi.hoisted(() => ({
  household: undefined as Household | undefined,
  search: "",
  replace: vi.fn(),
  requests: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/lib/api/household/useHousehold", () => ({
  default: () => ({ data: state.household }),
}));
vi.mock("@/lib/api/account/useTransactionsCategorySpending", () => ({
  default: (params: unknown) => {
    state.requests.push(params);
    return {
      isLoading: false,
      data: {
        categorySpending: [
          {
            amount: -120,
            bgColor: "#ffcc00",
            categoryKey: 7,
            childCategories: [],
            currency: "EUR",
            icon: undefined,
            isSystemCategory: false,
            name: "Groceries",
            numTransactions: 3,
            textColor: "#000000",
          },
        ],
      },
    };
  },
}));

const member = (appuserKey: number, firstName: string): HouseholdMember => ({
  appuserKey,
  emailAddress: `member${appuserKey}@example.com`,
  firstName,
  role: appuserKey === 1 ? "owner" : "member",
});

const householdOf = (members: HouseholdMember[]): Household => ({
  maxMembers: 5,
  members,
  pendingInvites: [],
  viewerAppuserKey: 1,
});

const fromDate = new Date("2026-01-01T00:00:00.000Z");
const toDate = new Date("2026-11-13T23:59:59.999Z");

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  state.household = householdOf([member(1, "Ana"), member(2, "Rui")]);
  state.search = "";
  state.replace.mockReset();
  state.requests = [];
});

afterEach(cleanup);

function renderSection() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enCategories, ...enHousehold }}
      onError={() => {}}
    >
      <AccountsCategorySpending
        fromDate={fromDate}
        toDate={toDate}
        userCurrency="EUR"
      />
    </NextIntlClientProvider>,
  );
}

const lastRequest = () =>
  state.requests.at(-1) as GetTransactionsCategorySpendingRequest;

test("without a member filter the section asks for the household's spending", () => {
  renderSection();

  assert.deepEqual(lastRequest(), { fromDate, toDate, limit: 6 });
  assert.ok(
    screen.getByRole("combobox", {
      name: enHousehold.household.attribution.filterLabel,
    }),
  );
});

test("the URL's member narrows the request to that member", () => {
  state.search = "member=2";
  renderSection();

  assert.deepEqual(lastRequest(), {
    fromDate,
    toDate,
    limit: 6,
    memberKeys: ["2"],
  });
  assert.equal(screen.getByRole("combobox").textContent, "Rui");
});

test("Shared asks for the household's joint spending", () => {
  state.search = "member=shared";
  renderSection();

  assert.deepEqual(lastRequest().memberKeys, ["shared"]);
});

test("choosing a member in the section's control puts them in the URL", async () => {
  renderSection();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  const options = await screen.findAllByRole("option");
  await user.click(options[1]);

  assert.equal(state.replace.mock.calls.length, 1);
  const params = new URLSearchParams(
    String(state.replace.mock.calls[0][0]).slice(1),
  );
  assert.equal(params.get("member"), "1");
});

test("a household of one has no control, and a stale URL member is ignored", () => {
  state.household = householdOf([member(1, "Ana")]);
  state.search = "member=2";
  renderSection();

  assert.equal(screen.queryByRole("combobox"), null);
  assert.equal("memberKeys" in lastRequest(), false);
  assert.ok(screen.getByText("Spending by category"));
});
