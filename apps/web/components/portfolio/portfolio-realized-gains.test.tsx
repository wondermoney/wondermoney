// @vitest-environment jsdom
import assert from "node:assert/strict";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import Papa from "papaparse";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import type {
  RealizedDisposal,
  RealizedGainsResponse,
} from "@/lib/api/portfolio/useRealizedGains";
import useRealizedGains from "@/lib/api/portfolio/useRealizedGains";
import { WithPrivacyMode } from "@/lib/privacy/privacy-test-utils";

import enCommon from "../../messages/en/common.json";
import enReports from "../../messages/en/reports.json";
import esCommon from "../../messages/es/common.json";
import esReports from "../../messages/es/reports.json";
import ptCommon from "../../messages/pt/common.json";
import ptReports from "../../messages/pt/reports.json";
import PortfolioClosedPositions from "./PortfolioClosedPositions";
import PortfolioHoldingsTable from "./PortfolioHoldingsTable";
import PortfolioRealizedGains from "./PortfolioRealizedGains";

vi.mock("@/lib/api/portfolio/useRealizedGains", () => ({ default: vi.fn() }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathname: () => "/en/portfolio",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./PortfolioHoldingDetailsModal", () => ({ default: () => null }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(useRealizedGains).mockReset();
});

const messages = {
  en: { ...enCommon, ...enReports },
  es: { ...esCommon, ...esReports },
  pt: { ...ptCommon, ...ptReports },
};

const sale = (overrides: Partial<RealizedDisposal>): RealizedDisposal => ({
  costBasis: 400,
  currencyCode: "EUR",
  date: "2025-03-10T00:00:00.000Z",
  financialAssetKey: 1,
  financialAssetName: "Example Equity Fund",
  holdingPeriodStart: "2025-01-10T00:00:00.000Z",
  portfolioKey: 7,
  portfolioName: "Shares",
  proceeds: 600,
  quantity: 4,
  realizedGain: 200,
  symbol: "EXMPL",
  transactionKey: 11,
  ...overrides,
});

const sales2026 = [
  sale({
    costBasis: 600,
    date: "2026-03-10T00:00:00.000Z",
    proceeds: 540,
    quantity: 6,
    realizedGain: -60,
    transactionKey: 12,
  }),
  sale({
    costBasis: 300,
    date: "2026-01-01T00:00:00.000Z",
    financialAssetKey: 2,
    financialAssetName: "Other Corp",
    proceeds: 330.5,
    quantity: 3,
    realizedGain: 30.5,
    symbol: "OTHR",
    transactionKey: 13,
  }),
];
const sales2025 = [sale({})];

const totals = (sales: RealizedDisposal[]) => ({
  costBasis: sales.reduce((sum, item) => sum + item.costBasis, 0),
  proceeds: sales.reduce((sum, item) => sum + item.proceeds, 0),
  realizedGain: sales.reduce((sum, item) => sum + item.realizedGain, 0),
  sales: sales.length,
});

function response(year: number | null): RealizedGainsResponse {
  const disposals =
    year === 2025
      ? sales2025
      : year === 2026
        ? sales2026
        : [...sales2026, ...sales2025];
  return {
    byAsset: [],
    byYear: [
      { ...totals(sales2025), year: 2025 },
      { ...totals(sales2026), year: 2026 },
    ],
    closedPositions: [
      {
        costBasis: 1000,
        financialAssetKey: 1,
        financialAssetLogoUrl: null,
        financialAssetName: "Example Equity Fund",
        financialAssetType: "ETF",
        holdingPeriodStart: "2025-01-10T00:00:00.000Z",
        lastSaleDate: "2026-03-10T00:00:00.000Z",
        proceeds: 1140,
        quantity: 10,
        realizedGain: 140,
        sales: 2,
        symbol: "EXMPL",
      },
    ],
    completeness: {
      currencyCode: "EUR",
      isComplete: true,
      unconvertedTransactions: 0,
    },
    currencyCode: "EUR",
    disposals,
    totals: totals(disposals),
    year,
  };
}

function mockReport(
  build: (year: number | null) => RealizedGainsResponse = response,
) {
  vi.mocked(useRealizedGains).mockImplementation(
    (_portfolioId, year) =>
      ({
        data: build(year ?? null),
        isError: false,
        isLoading: false,
      }) as unknown as ReturnType<typeof useRealizedGains>,
  );
}

function renderWith(node: React.ReactNode, locale: "en" | "es" | "pt" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <WithPrivacyMode hidden={false}>{node}</WithPrivacyMode>
    </NextIntlClientProvider>,
  );
}

const bodyRows = (table: HTMLElement) =>
  within(table).getAllByRole("row").slice(1);

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Clicks the CSV button and returns the parsed file. */
async function downloadCsv(user: ReturnType<typeof userEvent.setup>) {
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:realized-gains";
  });
  URL.revokeObjectURL = vi.fn();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    await user.click(
      screen.getByRole("button", { name: enReports.reports.export.csv }),
    );
    await waitFor(() => assert.equal(blobs.length, 1));
    const text = (await readBlob(blobs[0]!)).replace(/^\uFEFF/, "");
    return Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    }).data;
  } finally {
    click.mockRestore();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  }
}

test("lists each sale with its gain and the totals for every year", () => {
  mockReport();
  renderWith(<PortfolioRealizedGains portfolioId={7} />);

  const table = screen.getByRole("table");
  assert.equal(bodyRows(table).length, 3);
  assert.match(table.textContent ?? "", /OTHR/);
  // The lifetime total, signed.
  assert.ok(screen.getAllByText(/170\.50/).length >= 1);
});

test("the year filter shows only that year's sales", async () => {
  mockReport();
  const user = userEvent.setup();
  renderWith(<PortfolioRealizedGains portfolioId={7} />);

  await user.click(screen.getByRole("button", { name: "2025" }));

  assert.equal(
    screen.getByRole("button", { name: "2025" }).getAttribute("aria-pressed"),
    "true",
  );
  const rows = bodyRows(screen.getByRole("table"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.getAttribute("data-transaction-key"), "11");
});

test("the CSV holds exactly the sales on screen, in the same order", async () => {
  mockReport();
  const user = userEvent.setup();
  renderWith(<PortfolioRealizedGains portfolioId={7} />);
  await user.click(screen.getByRole("button", { name: "2026" }));

  const csv = await downloadCsv(user);
  const rows = bodyRows(screen.getByRole("table"));

  assert.equal(csv.length, rows.length);
  const onScreen = rows.map((row) =>
    Number(row.getAttribute("data-transaction-key")),
  );
  const byKey = new Map(sales2026.map((item) => [item.transactionKey, item]));
  csv.forEach((line, index) => {
    const shown = byKey.get(onScreen[index]!)!;
    assert.equal(line["Date"], shown.date.slice(0, 10));
    assert.equal(line["Asset"], shown.symbol);
    assert.equal(Number(line["Quantity"]), shown.quantity);
    assert.equal(Number(line["Proceeds"]), shown.proceeds);
    assert.equal(Number(line["Cost basis"]), shown.costBasis);
    assert.equal(Number(line["Realized gain"]), shown.realizedGain);
    assert.equal(line["Currency"], "EUR");
    // The figure in the file is the one in the row.
    assert.match(
      rows[index]!.textContent ?? "",
      new RegExp(Math.abs(shown.realizedGain).toFixed(2).replace(".", "\\.")),
    );
  });
});

test("renders nothing before the first sale", () => {
  mockReport(() => ({
    ...response(null),
    byYear: [],
    closedPositions: [],
    disposals: [],
  }));
  const { container } = renderWith(
    <>
      <PortfolioRealizedGains portfolioId={7} />
      <PortfolioClosedPositions portfolioId={7} />
    </>,
  );

  assert.equal(container.textContent, "");
});

test("lists a fully sold asset under closed positions with its lifetime result", () => {
  mockReport();
  renderWith(<PortfolioClosedPositions portfolioId={null} />);

  assert.ok(screen.getByRole("heading", { name: "Closed positions" }));
  const rows = bodyRows(screen.getByRole("table"));
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.textContent ?? "", /EXMPL/);
  assert.match(rows[0]!.textContent ?? "", /\+.*140\.00/);
});

test("the holdings table has a realized column", () => {
  const holding: PortfolioHolding = {
    allocation: 100,
    averageBuyPrice: 41.2,
    currency: "EUR",
    currentPrice: 48.9,
    currentValue: 1833.75,
    financialAssetKey: 1,
    financialAssetName: "Example Equity Fund",
    financialAssetSymbol: "EXMPL",
    financialAssetType: "ETF",
    quantity: 37.5,
    realizedGains: -12.5,
    unrealizedGains: 288.75,
    unrealizedGainsPercentage: 18.69,
  };
  renderWith(<PortfolioHoldingsTable transactions={[holding]} />);

  assert.ok(screen.getByText("Realized"));
  assert.match(screen.getAllByRole("row")[1]!.textContent ?? "", /12\.50/);
});

test("translates the realized gains view in every shipped locale", () => {
  mockReport();
  for (const [locale, heading] of [
    ["pt", "Ganhos Realizados"],
    ["es", "Ganancias realizadas"],
  ] as const) {
    const { unmount } = renderWith(
      <>
        <PortfolioRealizedGains portfolioId={7} />
        <PortfolioClosedPositions portfolioId={7} />
      </>,
      locale,
    );
    assert.ok(
      screen.getByRole("heading", { name: heading }),
      `${locale} heading`,
    );
    assert.ok(
      screen.getByRole("heading", {
        name: locale === "pt" ? "Posições fechadas" : "Posiciones cerradas",
      }),
      `${locale} closed positions`,
    );
    unmount();
  }
});
