// @vitest-environment jsdom
/**
 * The portfolios overview's Performance chart follows the member filter: the section carries the
 * filter control, and the chart asks for the URL member's portfolios. A household of one has no
 * control and no filter, whatever the URL says.
 */
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Household, HouseholdMember } from "@/lib/api/household/types";

import enCommon from "../../messages/en/common.json";
import enHousehold from "../../messages/en/household.json";
import PortfolioAggregatePerformance from "./PortfolioAggregatePerformance";

const state = vi.hoisted(() => ({
  household: undefined as Household | undefined,
  search: "",
  replace: vi.fn(),
  charts: [] as Record<string, unknown>[],
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
vi.mock("@/components/portfolio/PortfolioPerformanceChart", () => ({
  default: (props: Record<string, unknown>) => {
    state.charts.push(props);
    return null;
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

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  state.household = householdOf([member(1, "Ana"), member(2, "Rui")]);
  state.search = "";
  state.replace.mockReset();
  state.charts = [];
});

afterEach(cleanup);

function renderSection() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enHousehold }}
      onError={() => {}}
    >
      <PortfolioAggregatePerformance period="YTD" currency="EUR" />
    </NextIntlClientProvider>,
  );
}

const lastChart = () => state.charts.at(-1) ?? {};

test("without a member filter the chart shows every household portfolio", () => {
  renderSection();

  assert.deepEqual(lastChart(), {
    currency: "EUR",
    period: "YTD",
    portfolioId: null,
  });
  assert.ok(
    screen.getByRole("combobox", {
      name: enHousehold.household.attribution.filterLabel,
    }),
  );
});

test("the URL's member narrows the chart to that member's portfolios", () => {
  state.search = "member=2";
  renderSection();

  assert.deepEqual(lastChart().memberKeys, ["2"]);
  assert.equal(screen.getByRole("combobox").textContent, "Rui");
});

test("Shared charts a former member's portfolios", () => {
  state.search = "member=shared";
  renderSection();

  assert.deepEqual(lastChart().memberKeys, ["shared"]);
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
  assert.equal("memberKeys" in lastChart(), false);
  assert.ok(screen.getByRole("heading", { name: "Performance" }));
});
