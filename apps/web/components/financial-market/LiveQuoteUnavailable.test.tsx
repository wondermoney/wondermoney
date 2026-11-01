// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import { getTickerQuote } from "@/lib/api/financial-markets/useTickerQuote";

import enMessages from "../../messages/en/common.json";
import {
  LiveQuoteUnavailableLabel,
  LiveQuoteUnavailableNote,
  LiveQuoteUnavailableValue,
} from "./LiveQuoteUnavailable";

afterEach(cleanup);

function renderEn(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

test("a missing live quote is quiet information, not an alert", () => {
  const { container } = renderEn(
    <>
      <LiveQuoteUnavailableValue />
      <LiveQuoteUnavailableLabel />
      <LiveQuoteUnavailableNote />
    </>,
  );

  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(
    container.querySelector("button"),
    null,
    "no retry for a quote that will not recover",
  );
  assert.ok(
    container.textContent?.includes(
      enMessages["live-quote-unavailable-explanation"],
    ),
  );
});

test("the empty price slot is silent to a screen reader but carries a spoken label", () => {
  const { container } = renderEn(<LiveQuoteUnavailableValue />);

  const dash = [...container.querySelectorAll("span")].find(
    (span) => span.textContent === "—",
  );
  assert.ok(dash, "the slot shows an em dash");
  assert.equal(dash.getAttribute("aria-hidden"), "true");

  const spoken = container.querySelector(".sr-only");
  assert.equal(spoken?.textContent, enMessages["live-quote-unavailable"]);
});

test("a quote without a price or change stays null rather than becoming zero", async () => {
  const apiClient = {
    get: async () => ({
      data: { symbol: "AAPL", name: "Apple", price: null, changePercent: null },
    }),
  };

  const quote = await getTickerQuote("AAPL", apiClient as never);

  assert.equal(quote.price, null);
  assert.equal(quote.changePercentage, null);
});
