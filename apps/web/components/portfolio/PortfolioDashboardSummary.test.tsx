// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test } from "vitest";

import type {
  DashboardSummary,
  PeriodReturns,
} from "@/lib/api/portfolio/usePortfolioDashboard";
import { normalizeFinancialLocale } from "@/lib/utils/formatCurrency";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import PortfolioDashboardSummary from "./PortfolioDashboardSummary";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const summary: DashboardSummary = {
  assetCount: 2,
  currency: "EUR",
  lastUpdated: "2026-10-20T10:00:00.000Z",
  periodLabel: "1Y",
  periodReturn: 3.2,
  realizedGains: 40,
  totalGainLoss: 90,
  totalGainLossPercent: 9,
  totalValue: 1000,
  unrealizedGains: 50,
};

const periodReturns = (
  overrides: Partial<PeriodReturns> = {},
): PeriodReturns => ({
  timeWeighted: 10.5,
  moneyWeighted: -2.25,
  moneyWeightedAnnualized: false,
  missingSnapshotDates: [],
  ...overrides,
});

const locales = [
  { locale: "en", messages: enMessages },
  { locale: "pt", messages: ptMessages },
  { locale: "es", messages: esMessages },
] as const;

function renderSummary(
  value: DashboardSummary,
  locale = "en",
  messages: Record<string, unknown> = enMessages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <PortfolioDashboardSummary summary={value} />
    </NextIntlClientProvider>,
  );
}

/** The `dd` of the figure whose label is `name`. */
function figure(name: string) {
  const term = screen
    .getAllByRole("term")
    .find((dt) => dt.textContent?.startsWith(name));
  assert.ok(term, `no figure named ${name}`);
  const value = term.nextElementSibling;
  assert.ok(value);
  return value as HTMLElement;
}

for (const { locale, messages } of locales) {
  test(`both period returns are shown with their one-line explanations in ${locale}`, () => {
    renderSummary(
      { ...summary, periodReturns: periodReturns() },
      locale,
      messages,
    );

    assert.ok(
      figure(messages["time-weighted-return"]).textContent?.includes(
        messages["time-weighted-return-description"],
      ),
    );
    assert.ok(
      figure(messages["money-weighted-return"]).textContent?.includes(
        messages["money-weighted-return-description"],
      ),
    );
  });

  test(`the time-weighted figure is a signed percentage in ${locale}'s format`, () => {
    renderSummary(
      { ...summary, periodReturns: periodReturns() },
      locale,
      messages,
    );

    const expected = new Intl.NumberFormat(normalizeFinancialLocale(locale), {
      style: "percent",
      maximumFractionDigits: 2,
      signDisplay: "always",
    }).format(0.105);
    // The animated figure renders in a declarative shadow root, out of the
    // queryable tree; its accessible label is the formatted value.
    const label = figure(messages["time-weighted-return"]).innerHTML.match(
      /aria-label="([^"]+)"/,
    )?.[1];
    assert.equal(label?.replaceAll("&nbsp;", "\u00a0"), expected);
  });
}

test("a gain and a loss carry an icon beside their colour", () => {
  renderSummary({ ...summary, periodReturns: periodReturns() });

  const gain = figure(enMessages["time-weighted-return"])
    .previousElementSibling as HTMLElement;
  const loss = figure(enMessages["money-weighted-return"])
    .previousElementSibling as HTMLElement;
  assert.ok(gain.querySelector(".text-success-text svg"));
  assert.ok(loss.querySelector(".text-destructive-text svg"));
});

test("the money-weighted return says when it is a yearly rate", () => {
  renderSummary({
    ...summary,
    periodReturns: periodReturns({ moneyWeightedAnnualized: true }),
  });

  assert.ok(figure(enMessages["money-weighted-return-annualized"]));
  assert.equal(
    screen
      .getAllByRole("term")
      .some((dt) => dt.textContent === enMessages["money-weighted-return"]),
    false,
  );
});

test("a return that cannot be measured reads as unavailable, not zero", () => {
  renderSummary({
    ...summary,
    periodReturns: periodReturns({ timeWeighted: null, moneyWeighted: null }),
  });

  for (const name of [
    enMessages["time-weighted-return"],
    enMessages["money-weighted-return"],
  ]) {
    assert.ok(
      figure(name).textContent?.startsWith(
        enMessages["portfolio-metric-unavailable"],
      ),
    );
  }
});

test("days without a snapshot are noted, and only when there are some", () => {
  renderSummary({
    ...summary,
    periodReturns: periodReturns({
      missingSnapshotDates: ["2026-03-01", "2026-03-02"],
    }),
  });
  assert.match(screen.getByRole("note").textContent ?? "", /\b2\b/);
  cleanup();

  renderSummary({ ...summary, periodReturns: periodReturns() });
  assert.equal(screen.queryByRole("note"), null);
});

test("without period returns from the API, neither figure is shown", () => {
  renderSummary(summary);

  const names = screen.getAllByRole("term").map((dt) => dt.textContent);
  assert.equal(
    names.some((name) => name?.startsWith(enMessages["time-weighted-return"])),
    false,
  );
});
