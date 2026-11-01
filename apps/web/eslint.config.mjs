import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

/*
 * Money, numbers and dates must be formatted in the reader's locale (the URL
 * segment), not the runtime's. `Intl` with an undefined locale and a bare
 * `toLocaleString()` resolve to the browser's or the container's locale, which
 * renders `€185,000.00` on `/pt` and can disagree between SSR and hydration.
 */
const localeFormattingRules = [
  {
    selector:
      "NewExpression[callee.object.name='Intl'][callee.property.name=/^(NumberFormat|DateTimeFormat)$/][arguments.0.type='Identifier'][arguments.0.name='undefined']",
    message:
      "An Intl formatter with no locale uses the runtime's locale, not the reader's. Use the matching use* hook (useFormatCurrency, useFormatNumber, …) or pass a locale.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.length=0]",
    message:
      "A bare toLocale*String() uses the runtime's locale, not the reader's. Use the matching use* hook or pass a locale.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.0.type='Identifier'][arguments.0.name='undefined']",
    message:
      "toLocale*String(undefined, …) uses the runtime's locale, not the reader's. Use the matching use* hook or pass a locale.",
  },
];

/* A formatted string has no seam to mute the currency symbol; <Amount> does. */
const moneyMarkupRules = [
  {
    selector: "JSXExpressionContainer > CallExpression[callee.name='formatCurrency']",
    message:
      "Render money through <Amount> rather than interpolating a formatted string into JSX.",
  },
];

/*
 * Colour comes from the semantic theme tokens in theme/globals.css, so every
 * surface follows light/dark mode and keeps its contrast pairing. A raw
 * Tailwind palette class (any variant stack in front of it) bypasses both.
 */
const PALETTE_FAMILIES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOUR_UTILITIES =
  "bg|text|border(?:-[trblxyse])?|divide(?:-[xy])?|ring(?:-offset)?|outline|fill|stroke|shadow|from|via|to|accent|caret|decoration|placeholder";
const PALETTE_CLASS = `(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:${PALETTE_FAMILIES})-\\d\\d\\d?(?![\\w-])`;
const paletteRules = [
  {
    selector: `Literal[value=/${PALETTE_CLASS}/]`,
    message: "Use a semantic theme token (theme/globals.css) instead of a Tailwind palette class.",
  },
  {
    selector: `TemplateElement[value.raw=/${PALETTE_CLASS}/]`,
    message: "Use a semantic theme token (theme/globals.css) instead of a Tailwind palette class.",
  },
];

/*
 * A popover rendered inside a dialog's scroll container is clipped by it, and a
 * non-portalled searchable select inside the Add Transaction dialog tore the
 * dialog down on selection, discarding the form.
 */
const popoverRules = [
  {
    selector:
      "JSXAttribute[name.name='portalled'] > JSXExpressionContainer > Literal[value=false]",
    message:
      "Keep popovers portalled: inside a dialog a non-portalled popover is clipped by the dialog's scroll container.",
  },
];

/** Modules that bind a locale themselves, or define the locale-less helpers. */
const LOCALE_BINDING_MODULES = [
  "lib/utils/formatCurrency.ts",
  "lib/utils/formatPercentage.ts",
  "lib/utils/formatNumber.ts",
  "lib/utils/useFormatCurrency.ts",
  "lib/utils/useFormatPercentage.ts",
  "lib/utils/useFormatNumber.ts",
  "components/ui/charts/chart-formatters.ts",
  "components/ui/charts/useChartFormatters.ts",
  "components/ui/Amount.tsx",
];

/** Chart tooltips build their own markup from the chart's formatter strings. */
const CHART_TOOLTIPS = [
  "components/dashboard/DashboardNetWorthHistoryChart.tsx",
  "components/financial-market/FinancialMarketsTickerEarnings.tsx",
  "components/portfolio/PortfolioAllocationChart.tsx",
];

const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

/** `no-restricted-syntax` does not merge across config objects, so each scope restates its list. */
function restrictedSyntax({ locale = true, money = true, palette = true } = {}) {
  return [
    "error",
    ...(locale ? localeFormattingRules : []),
    ...(money ? moneyMarkupRules : []),
    ...(palette ? paletteRules : []),
    ...popoverRules,
  ];
}

const config = [
  {
    ignores: ["node_modules/", ".next/", "out/", ".github/", "public/", "scripts/", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  prettier,
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: {
      "no-restricted-syntax": restrictedSyntax(),
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/utils/formatCurrency",
              importNames: ["formatCurrency"],
              message:
                "formatCurrency formats in the runtime's locale. Use useFormatCurrency() in a Client Component or formatCurrencyForLocale() with an explicit locale.",
            },
          ],
        },
      ],
    },
  },
  {
    // A test that reads source or config text off disk only fails when the code is
    // refactored, never when the behaviour breaks: render it or call it instead.
    // `scripts/` is ignored above, so its CSV-fixture test is unaffected.
    files: TESTS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "node:fs", "fs/promises", "node:fs/promises"].map((name) => ({
            name,
            message:
              "Tests must not read files off disk. Import JSON fixtures, or render/call the code under test.",
          })),
        },
      ],
    },
  },
  {
    files: LOCALE_BINDING_MODULES,
    rules: {
      "no-restricted-syntax": restrictedSyntax({ locale: false, money: false }),
      "no-restricted-imports": "off",
    },
  },
  {
    files: CHART_TOOLTIPS,
    rules: { "no-restricted-syntax": restrictedSyntax({ money: false }) },
  },
];

export default config;
