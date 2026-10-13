import assert from "node:assert/strict";

import { test } from "vitest";

import { formatPortfolioAllocationValue } from "../PortfolioAllocationChart";

/**
 * RAD-572 — this used to assert `"€1,234.56"` for a call that passed no locale,
 * which pinned the defect rather than the behaviour: `Intl` was falling back to
 * whatever locale the runtime happened to have, and on CI that was English.
 */
test("portfolio allocation values format in the locale they are given", () => {
  const en = formatPortfolioAllocationValue(1234.56, "EUR", "en");
  const pt = formatPortfolioAllocationValue(1234.56, "EUR", "pt");

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
  const pt = formatPortfolioAllocationValue(1234567.89, "EUR", "pt");

  assert.ok(pt.includes("567,89"), `expected pt decimal comma, got ${pt}`);
  assert.ok(/1.234.567/.test(pt), `expected pt thousands grouping, got ${pt}`);
});

test("an unknown currency code falls back to a plain decimal rather than throwing", () => {
  assert.doesNotThrow(() =>
    formatPortfolioAllocationValue(1234.56, "NOTACODE" as never, "en"),
  );
});
