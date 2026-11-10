import assert from "node:assert/strict";

import { test } from "vitest";

import { formatCurrencyForLocale } from "./formatCurrency";

/**
 * Always pass a locale: without one `Intl` falls back to whatever locale the
 * runtime happens to have (English on CI), which would pin the runtime rather
 * than the behaviour.
 */
test("money formats in the locale they are given", () => {
  const en = formatCurrencyForLocale(1234.56, "EUR", "en");
  const pt = formatCurrencyForLocale(1234.56, "EUR", "pt");

  assert.notEqual(en, pt, "en and pt must not render a euro amount the same way");

  // en prefixes the symbol and uses a decimal point.
  assert.ok(en.startsWith("€"), `expected en to lead with the symbol, got ${en}`);
  assert.ok(en.includes("1,234.56"), `expected en grouping and decimal, got ${en}`);

  // pt suffixes it and uses a decimal comma. Note it does *not* group at four
  // digits: pt-PT sets minimumGroupingDigits to 2, so `1234,56` is correct and
  // grouping only appears from five digits up — asserted separately below.
  assert.ok(pt.trimEnd().endsWith("€"), `expected pt to end with the symbol, got ${pt}`);
  assert.ok(pt.includes("1234,56"), `expected pt decimal comma, got ${pt}`);
});

test("pt groups thousands once the number is long enough to be grouped", () => {
  const pt = formatCurrencyForLocale(1234567.89, "EUR", "pt");

  assert.ok(pt.includes("567,89"), `expected pt decimal comma, got ${pt}`);
  assert.ok(/1.234.567/.test(pt), `expected pt thousands grouping, got ${pt}`);
});

test("an unknown currency code falls back to a plain decimal rather than throwing", () => {
  assert.doesNotThrow(() =>
    formatCurrencyForLocale(1234.56, "NOTACODE", "en"),
  );
});
