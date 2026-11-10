import assert from "node:assert/strict";

import { test } from "vitest";

import { formatQuantityForDisplay } from "./format-quantity";
import { AMOUNT_MASK } from "./mask";

test("formatQuantityForDisplay formats in the locale while visible", () => {
  assert.equal(
    formatQuantityForDisplay(1234.5, "en", { hidden: false }),
    "1,234.5",
  );
  assert.equal(
    formatQuantityForDisplay("12.50000000", "pt", { hidden: false }),
    "12,5",
  );
  assert.equal(
    formatQuantityForDisplay(0.123456789, "en", {
      hidden: false,
      maximumFractionDigits: 6,
    }),
    "0.123457",
  );
});

test("formatQuantityForDisplay shows an unparseable wire value as sent", () => {
  assert.equal(formatQuantityForDisplay("n/a", "en", { hidden: false }), "n/a");
});

test("a hidden quantity is the fixed mask, with no digit, sign or magnitude", () => {
  for (const value of [
    0,
    1,
    -3,
    0.00000001,
    12_345_678.9,
    "250.00000000",
    "n/a",
  ]) {
    for (const locale of ["en", "pt", "es"]) {
      const masked = formatQuantityForDisplay(value, locale, { hidden: true });
      assert.equal(masked, AMOUNT_MASK);
      assert.ok(!/[\d+\-−]/.test(masked));
    }
  }
});
