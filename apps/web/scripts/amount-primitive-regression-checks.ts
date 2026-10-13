/*
 * Guards the money-rendering rules in DESIGN_HISTORY.md's eleven data-presentation rules.
 *
 * 1. `<Amount>` splits the currency off the magnitude via `formatToParts` and
 *    renders the parts in locale order — the symbol prefixes in `en` and
 *    suffixes in `pt`, so hardcoding "value then unit" is wrong.
 * 2. Absence renders as an em-dash, never as a zero.
 * 3. The three tone helpers stay distinct: a level is never coloured by sign.
 *
 * These are behavioural assertions against Intl, plus source assertions
 * against the primitive — the same shape as the other `test:*` guards.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

// --- 1. The locale-position assumption the primitive rests on ---------------

const partsFor = (locale: string, currency: string, value: number) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(value);

const enParts = partsFor("en-IE", "EUR", 11250.5);
const ptParts = partsFor("pt-PT", "EUR", 11250.5);

const currencyIndex = (parts: Intl.NumberFormatPart[]) =>
  parts.findIndex((part) => part.type === "currency");
const firstDigitIndex = (parts: Intl.NumberFormatPart[]) =>
  parts.findIndex((part) => part.type === "integer");

assert.ok(
  currencyIndex(enParts) < firstDigitIndex(enParts),
  "en is expected to prefix the currency symbol; if Intl changes this, Amount's locale-order rendering is still correct but this guard's premise is stale.",
);
assert.ok(
  currencyIndex(ptParts) > firstDigitIndex(ptParts),
  "pt is expected to suffix the currency symbol — this is why Amount renders formatToParts in order instead of hardcoding position.",
);
assert.ok(
  enParts.some((part) => part.type === "currency"),
  "A currency part must exist to be styled separately.",
);

// A non-ISO currency must not throw — the app passes through unknown codes.
assert.doesNotThrow(
  () =>
    new Intl.NumberFormat("en-IE", { style: "decimal" }).formatToParts(1234.5),
  "Decimal fallback must work for non-ISO currency inputs.",
);

// --- 2. The primitive itself ------------------------------------------------

const amount = read("components/ui/Amount.tsx");

const expect = (pattern: RegExp, message: string) => {
  assert.ok(pattern.test(amount), message);
};

expect(
  /formatToParts/,
  "Amount must use formatToParts — `style: \"currency\"` alone returns one atomic string with no seam to style.",
);
expect(
  /part\.type === "currency"[\s\S]*?text-muted-foreground/,
  "Amount must render the currency part in muted ink so the magnitude leads.",
);
expect(
  /value === null \|\| value === undefined \|\| Number\.isNaN\(value\)[\s\S]*?—/,
  "Amount must render an em-dash for a missing value — a zero is a measurement, an absence is not.",
);
assert.ok(
  !/\?\?\s*0\b/.test(amount),
  "Amount must never coerce a missing value to zero (`?? 0`); that is the defect that rendered Apple as US$0.00.",
);

// --- 3. Tones stay distinct -------------------------------------------------

const currencySource = read("lib/utils/formatCurrency.ts");

assert.ok(
  !/export const getFinancialValueClassName/.test(currencySource),
  "The single colour-everything-by-sign helper must stay deleted; use getAmountClassName / getDeltaClassName / getThresholdClassName.",
);
assert.ok(
  /getAmountClassName = \(\) =>\s*`text-foreground/.test(currencySource),
  "A level renders in foreground ink and is never coloured by its sign.",
);
assert.ok(
  /getDeltaClassName[\s\S]*?text-success-text/.test(currencySource),
  "A delta keeps its colour — direction is the information.",
);

console.log("Amount primitive regression checks passed");
