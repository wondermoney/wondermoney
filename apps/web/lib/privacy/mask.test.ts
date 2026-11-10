import assert from "node:assert/strict";

import { test } from "vitest";

import { formatMoneyForDisplay, formatMoneyForScreenReader } from "./format-money";
import { AMOUNT_MASK, maskMoney } from "./mask";

test("the mask keeps the currency symbol where the locale puts it", () => {
  assert.equal(maskMoney("EUR", "en"), `€${AMOUNT_MASK}`);
  const pt = maskMoney("EUR", "pt");
  assert.ok(pt.startsWith(AMOUNT_MASK), pt);
  assert.ok(pt.trimEnd().endsWith("€"), pt);
});

test("the mask carries no digit, sign or magnitude", () => {
  for (const locale of ["en", "pt", "es"]) {
    for (const currency of ["EUR", "USD", "JPY", "", undefined, null]) {
      const mask = maskMoney(currency, locale);
      assert.ok(!/[\d+\-−]/.test(mask), `${locale}/${currency}: ${mask}`);
      assert.ok(mask.includes(AMOUNT_MASK));
    }
  }
});

test("formatMoneyForDisplay masks only while hidden", () => {
  assert.equal(
    formatMoneyForDisplay(1234.5, "EUR", "en", { hidden: false }),
    "€1,234.50",
  );
  const hidden = formatMoneyForDisplay(1234.5, "EUR", "en", { hidden: true });
  assert.equal(hidden, `€${AMOUNT_MASK}`);
});

test("the spoken form reads the hidden label instead of the figure", () => {
  assert.equal(
    formatMoneyForScreenReader(1234.5, "EUR", "en", {
      hidden: true,
      hiddenLabel: "Hidden amount",
    }),
    "Hidden amount",
  );
  assert.match(
    formatMoneyForScreenReader(1234.5, "EUR", "en", {
      hidden: false,
      hiddenLabel: "Hidden amount",
    }),
    /1,234\.50 euros/,
  );
});
