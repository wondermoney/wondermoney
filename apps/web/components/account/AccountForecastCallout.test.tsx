// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, it } from "vitest";

import type { ForecastSeries } from "@/lib/api/account/useAccountForecast";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";

import commonMessages from "../../messages/en/common.json";
import AccountForecastCallout from "./AccountForecastCallout";

afterEach(cleanup);

const series: ForecastSeries = {
  complete: true,
  currency: "EUR",
  lowPoint: { balance: 900, date: "2026-03-06" },
  openingBalance: 1000,
  points: [
    { balance: 1000, date: "2026-03-01" },
    { balance: 900, date: "2026-03-06" },
  ],
  projected: [],
};

function renderCallout(value = series) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <AccountForecastCallout days={30} series={value} />
    </NextIntlClientProvider>,
  );
}

describe("AccountForecastCallout", () => {
  it("names the low point, its day and its figure", () => {
    const { container } = renderCallout();

    assert.match(container.textContent ?? "", /Low point in the next 30 days/);
    assert.match(
      container.textContent ?? "",
      new RegExp(
        formatShortDateForLocale(
          transactionDisplayDate("2026-03-06T00:00:00.000Z"),
          "en",
        ),
      ),
    );
    assert.match(container.textContent ?? "", /900\.00/);
  });

  it("says the account cannot be projected instead of showing a zero", () => {
    const { container } = renderCallout({
      ...series,
      lowPoint: null,
      openingBalance: null,
      points: [],
    });

    assert.match(
      container.textContent ?? "",
      /Not enough data to project this account yet\./,
    );
    assert.doesNotMatch(container.textContent ?? "", /0\.00/);
    assert.equal(screen.queryByText("Low point in the next 30 days"), null);
  });
});
