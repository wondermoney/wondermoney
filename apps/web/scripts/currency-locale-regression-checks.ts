/**
 * Guards RAD-572: money is formatted in the locale the reader chose.
 *
 * `formatCurrency` passes `undefined` for locale, and `Intl.NumberFormat(undefined)`
 * resolves to the *runtime's* locale — the browser's in a Client Component, the
 * container's during SSR. Neither is the locale in the URL segment. A Portuguese
 * user browsing with an English browser read `€185,000.00` on `/pt`, and the
 * server and the client could disagree about the same node, which is a hydration
 * mismatch that visibly rewrites figures after hydration.
 *
 * RAD-571 fixed the loans module by moving it onto `<Amount>`; RAD-572 found the
 * same defect in 43 other files. The fix there was `useFormatCurrency()`, which
 * binds the active locale and keeps `formatCurrency`'s signature so the ~110
 * call sites did not have to change.
 *
 * That leaves one way for this to come back: someone imports the bare
 * `formatCurrency` again. So the import is what this asserts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * The only modules allowed to reference the locale-less `formatCurrency`.
 *
 * - the helper module itself defines it;
 * - `<Amount>` reaches for the class-name helpers next to it, not the formatter;
 * - `useFormatCurrency` is the sanctioned wrapper.
 */
const ALLOWED = new Set([
  "lib/utils/formatCurrency.ts",
  "lib/utils/useFormatCurrency.ts",
  "components/ui/Amount.tsx",
]);

/**
 * RAD-575 — the same defect, for every other kind of formatted value.
 *
 * Money was only the loudest case. Percentages, compact numbers, chart axes and
 * dates all resolved `undefined` to the runtime's locale too, so the rule is now
 * about the *construction*, not about one helper: nothing outside the
 * locale-binding modules may build an `Intl` formatter without a locale, or call
 * a bare `toLocaleString`-family method.
 */
const LOCALE_BINDING_MODULES = new Set([
  "lib/utils/formatCurrency.ts",
  "lib/utils/formatPercentage.ts",
  "lib/utils/formatNumber.ts",
  "lib/utils/useFormatCurrency.ts",
  "lib/utils/useFormatPercentage.ts",
  "lib/utils/useFormatNumber.ts",
  "components/ui/charts/chart-formatters.ts",
  "components/ui/charts/useChartFormatters.ts",
  "components/ui/Amount.tsx",
]);

/** Every tracked source file, so a new component is covered by construction. */
const sourceFiles = execFileSync(
  "git",
  ["ls-files", "app", "components", "lib", "*.ts", "*.tsx"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path) && !path.includes("__tests__"));

// --- 1. nobody imports the locale-less formatter -----------------------------

const BARE_IMPORT =
  /import\s*\{[^}]*\bformatCurrency\b[^}]*\}\s*from\s*"@\/lib\/utils\/formatCurrency"/;

const offenders = sourceFiles.filter(
  (path) => !ALLOWED.has(path) && BARE_IMPORT.test(read(path)),
);

assert.deepEqual(
  offenders,
  [],
  `these import the locale-less formatCurrency — use useFormatCurrency() in a Client Component, or formatCurrencyForLocale() with an explicit locale in a Server Component:\n  ${offenders.join("\n  ")}`,
);

// --- 1b. no Intl formatter is built without a locale -------------------------

/** Strips comments so prose *about* the defect does not count as the defect. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const UNDEFINED_LOCALE = /new Intl\.(NumberFormat|DateTimeFormat)\(\s*undefined/;

/**
 * Both spellings of "no locale".
 *
 * This only matched empty parens, so `TableCellDate` sat on
 * `toLocaleDateString(undefined, { … })` through the whole of RAD-575 —
 * *explicitly* passing undefined to reach the options argument, which is the
 * more common shape precisely because you need options to get there. The guard
 * was checking for the version nobody writes.
 */
const BARE_TO_LOCALE =
  /\.toLocale(String|DateString|TimeString)\(\s*(\)|undefined\b)/;

const localeless = sourceFiles.filter((path) => {
  if (LOCALE_BINDING_MODULES.has(path)) return false;
  const code = stripComments(read(path));
  return UNDEFINED_LOCALE.test(code) || BARE_TO_LOCALE.test(code);
});

assert.deepEqual(
  localeless,
  [],
  `these build an Intl formatter with no locale, or call a bare toLocaleString — both resolve to the runtime's locale, not the reader's. Use the matching use* hook, or pass a locale explicitly:\n  ${localeless.join("\n  ")}`,
);

// --- 2. the hook actually threads the locale through -------------------------

const hook = read("lib/utils/useFormatCurrency.ts");

assert.match(
  hook,
  /useLocale\(\)/,
  "useFormatCurrency must read the active locale — without it this is the bug it replaced",
);
assert.match(
  hook,
  /formatCurrencyForLocale\(/,
  "useFormatCurrency must delegate to formatCurrencyForLocale, the variant that takes a locale",
);

for (const [path, delegate] of [
  ["lib/utils/useFormatPercentage.ts", "formatPercentageForLocale("],
  ["lib/utils/useFormatNumber.ts", "formatNumberForLocale("],
  ["components/ui/charts/useChartFormatters.ts", "useLocale()"],
] as const) {
  const source = read(path);
  assert.match(source, /useLocale\(\)/, `${path} must read the active locale`);
  assert.ok(
    source.includes(delegate),
    `${path} must delegate to the locale-taking variant (${delegate})`,
  );
}

// --- 3. the premise: these locales really do disagree ------------------------

const format = (locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(185000);

assert.notEqual(
  format("en"),
  format("pt-PT"),
  "en and pt-PT must render a euro amount differently — if Intl ever stops distinguishing them, this guard's premise is stale, not its subject",
);


// --- 4. money reaches the DOM through <Amount>, not as a formatted string ----

/*
 * DESIGN_HISTORY.md rule 1: the currency token is muted and the magnitude is not, so
 * the eye compares figures down a column and skips a symbol identical on every
 * row. That split only exists inside `<Amount>` — `formatCurrency` returns one
 * atomic string with no seam to style.
 *
 * So a *formatted string interpolated straight into JSX* is the regression. A
 * `formatCurrency` call passed to a chart's `xFormatter` / `yFormatter` is not:
 * those must return strings, which is why the check is on the interpolation and
 * not on the call.
 */
const MONEY_IN_JSX = /\{\s*formatCurrency\(/;

const stringifiedMoney = sourceFiles.filter((path) => {
  if (LOCALE_BINDING_MODULES.has(path)) return false;
  const code = stripComments(read(path));
  if (!MONEY_IN_JSX.test(code)) return false;
  // Chart tooltips legitimately build their own markup from strings.
  return !/Formatter=|Formatter:|formatter=\{/.test(code);
});

assert.deepEqual(
  stringifiedMoney,
  [],
  `these interpolate a formatted money string into JSX — use <Amount> so the currency can recede (DESIGN_HISTORY.md rule 1):\n  ${stringifiedMoney.join("\n  ")}`,
);

console.log("Currency locale regression checks passed");
