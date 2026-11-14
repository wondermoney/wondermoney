// @vitest-environment jsdom
/**
 * The portfolios overview has one member filter, in the page's control row, and every section
 * follows it: the summary and breakdown, metrics, Performance, Allocation, Benchmark Comparison,
 * Top Movers, the calendar, dividend income, holdings, realized gains and closed positions all
 * ask for the URL member's portfolios. A household of one has no control and no filter, whatever
 * the URL says.
 */
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Household, HouseholdMember } from "@/lib/api/household/types";

import enCommon from "../../../../messages/en/common.json";
import enHousehold from "../../../../messages/en/household.json";
import Portfolio from "./page";

/** What each section was last asked for: its `memberKeys` (absent for everyone). */
const state = vi.hoisted(() => {
  const sections = new Map<string, { memberKeys?: readonly string[] }>();
  const record = (name: string, memberKeys: readonly string[] | undefined) =>
    sections.set(name, memberKeys ? { memberKeys } : {});
  return {
    household: undefined as Household | undefined,
    search: "",
    replace: vi.fn(),
    sections,
    record,
    /** A section component that records the member filter it was given. */
    recordingSection: (name: string) => ({
      default: (props: { memberKeys?: readonly string[] }) => {
        record(name, props.memberKeys);
        return null;
      },
    }),
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ id: "user-1" }),
}));
vi.mock("@/lib/api/household/useHousehold", () => ({
  default: () => ({ data: state.household }),
}));

vi.mock("@/lib/api/portfolio/usePortfolios", () => ({
  default: () => ({
    data: { portfolios: [{ portfolioKey: 3, name: "Broker" }] },
    isError: false,
    isLoading: false,
  }),
}));
vi.mock("@/lib/api/portfolio/usePortfolioDashboard", () => ({
  useAggregateDashboard: (
    _period: string,
    _options: unknown,
    memberKeys?: readonly string[],
  ) => {
    state.record("summary", memberKeys);
    return {
      data: {
        portfolios: [],
        summary: { currency: "EUR", portfolioCount: 1, totalValue: 0 },
      },
      isError: false,
      isLoading: false,
    };
  },
}));
vi.mock("@/lib/api/portfolio/usePortfoliosHoldings", () => ({
  default: (_options: unknown, memberKeys?: readonly string[]) => {
    state.record("holdings", memberKeys);
    return { data: { holdings: [] }, isLoading: false };
  },
}));
vi.mock("@/lib/api/portfolio/usePortfolioMetrics", () => ({
  default: (
    _from: unknown,
    _options: unknown,
    memberKeys?: readonly string[],
  ) => {
    state.record("metrics", memberKeys);
    return { data: undefined };
  },
}));
vi.mock("@/lib/api/portfolio/useDividendIncome", () => ({
  default: (
    _id: unknown,
    _options: unknown,
    memberKeys?: readonly string[],
  ) => {
    state.record("dividend-income-check", memberKeys);
    return { data: { totalDividends: 10 } };
  },
}));

vi.mock("@/components/portfolio/PortfolioPerformanceChart", () =>
  state.recordingSection("performance"),
);
vi.mock("@/components/portfolio/PortfolioAllocationChart", () =>
  state.recordingSection("allocation"),
);
vi.mock("@/components/portfolio/PortfolioBenchmarkChart", () =>
  state.recordingSection("benchmark"),
);
vi.mock("@/components/portfolio/PortfolioTopMovers", () =>
  state.recordingSection("top-movers"),
);
vi.mock("@/components/portfolio/PortfolioCalendar", () =>
  state.recordingSection("calendar"),
);
vi.mock("@/components/portfolio/PortfolioDividendIncome", () =>
  state.recordingSection("dividend-income"),
);
vi.mock("@/components/portfolio/PortfolioRealizedGains", () =>
  state.recordingSection("realized-gains"),
);
vi.mock("@/components/portfolio/PortfolioClosedPositions", () =>
  state.recordingSection("closed-positions"),
);
vi.mock("@/components/portfolio/PortfolioDashboardSummary", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioBreakdown", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioHoldingsTable", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioMetrics", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioTransactionAddModal", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioTransactionImportModal", () => ({
  default: () => null,
}));
vi.mock("@/components/portfolio/PortfolioCreateDialog", () => ({
  default: () => null,
}));

/** Every section on the overview, by what it reads. */
const SECTIONS = [
  "summary",
  "metrics",
  "performance",
  "allocation",
  "benchmark",
  "top-movers",
  "calendar",
  "dividend-income-check",
  "dividend-income",
  "holdings",
  "realized-gains",
  "closed-positions",
];

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
  state.sections.clear();
});

afterEach(cleanup);

function renderPage() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enHousehold }}
      onError={() => {}}
    >
      <Portfolio />
    </NextIntlClientProvider>,
  );
}

/** The filter every section was given; one entry means they all agree. */
const filters = () => {
  assert.deepEqual([...state.sections.keys()].toSorted(), SECTIONS.toSorted());
  return [
    ...new Set(
      [...state.sections.values()].map((section) => JSON.stringify(section)),
    ),
  ];
};

test("without a member filter every section shows the whole household", () => {
  renderPage();

  assert.deepEqual(filters(), [JSON.stringify({})]);
});

test("the URL's member narrows every section to that member's portfolios", () => {
  state.search = "member=2";
  renderPage();

  assert.deepEqual(filters(), [JSON.stringify({ memberKeys: ["2"] })]);
  assert.equal(
    screen.getByRole("combobox", {
      name: enHousehold.household.attribution.filterLabel,
    }).textContent,
    "Rui",
  );
});

test("Shared narrows every section to a former member's portfolios", () => {
  state.search = "member=shared";
  renderPage();

  assert.deepEqual(filters(), [JSON.stringify({ memberKeys: ["shared"] })]);
});

test("one control, in the page's header, drives the filter: choosing a member puts them in the URL", async () => {
  renderPage();
  // A single member control on the page, and none inside a section.
  const controls = screen.getAllByRole("combobox", {
    name: enHousehold.household.attribution.filterLabel,
  });
  assert.equal(controls.length, 1);
  const performance = screen
    .getByRole("heading", { name: "Performance" })
    .closest("section");
  assert.ok(performance);
  assert.equal(within(performance).queryByRole("combobox"), null);

  const user = userEvent.setup();
  await user.click(controls[0]!);
  await user.click(await screen.findByRole("option", { name: "Rui" }));

  assert.equal(state.replace.mock.calls.length, 1);
  const params = new URLSearchParams(
    String(state.replace.mock.calls[0]![0]).slice(1),
  );
  assert.equal(params.get("member"), "2");
});

test("a household of one has no control, and a stale URL member is ignored everywhere", () => {
  state.household = householdOf([member(1, "Ana")]);
  state.search = "member=2";
  renderPage();

  assert.equal(
    screen.queryByRole("combobox", {
      name: enHousehold.household.attribution.filterLabel,
    }),
    null,
  );
  assert.deepEqual(filters(), [JSON.stringify({})]);
});
