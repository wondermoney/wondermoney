import assert from "node:assert/strict";

import { test } from "vitest";

import { getTickerQuote } from "@/lib/api/financial-markets/useTickerQuote";
import { formatMoneyForDisplay } from "@/lib/privacy/format-money";

import { formatQuotePrice } from "./quote-price";

const formatEn = (
  value: number,
  currency = "EUR",
  options?: Intl.NumberFormatOptions,
) => formatMoneyForDisplay(value, currency, "en", { ...options, hidden: false });

test("a quote's price is shown in the currency the security is listed in", () => {
  assert.equal(formatQuotePrice(formatEn, 185.64, "EUR"), "€185.64");
  assert.equal(formatQuotePrice(formatEn, 72.5, "GBP"), "£72.50");
});

test("a quote with no known currency shows the bare number, not a dollar sign", () => {
  const text = formatQuotePrice(formatEn, 185.6, null);

  assert.equal(text, "185.60");
});

test("the quote's currency reaches the watchlist", async () => {
  const apiClient = {
    get: async () => ({
      data: {
        symbol: "EXMP",
        name: null,
        price: 10,
        changePercent: 1,
        currency: "EUR",
      },
    }),
  };

  const quote = await getTickerQuote("EXMP", apiClient as never);

  assert.equal(quote.currency, "EUR");
});
