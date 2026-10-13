/**
 * RAD-548 — the market-data section is quote-less, not down.
 *
 * The unconditional `FmpOutageBanner` claimed Portfolio and Markets were "out
 * of service" on every visit while ticker search, price history and the
 * company profile all worked. It is gone. What replaces it is a per-surface
 * "no live price" state on the two surfaces that genuinely have no quote, and
 * nothing at all on the surfaces that work.
 *
 * These checks lock in: the banner stays deleted, the quote-less state stays
 * calm (no alert role, no spinner, no retry), the working surfaces stay clean,
 * and the copy stays translated in all three locales.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

/**
 * Several checks below scan for markup that must not be there. Comments in
 * these files legitimately *name* the thing being forbidden ("no alert role,
 * no retry affordance"), so strip them first or the prose fails its own check.
 */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collectSourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, directory))) {
    const relative = `${directory}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) {
      out.push(...collectSourceFiles(relative));
    } else if (/\.(tsx?|jsx?|json)$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

const locales = ["en", "pt", "es"] as const;

// 1. The banner component and every reference to it are gone.

assert(
  !existsSync(join(root, "components/financial-market/FmpOutageBanner.tsx")),
  "FmpOutageBanner.tsx should be deleted — the outage it announced is the steady state, not an outage",
);

const searchRoots = ["app", "components", "lib", "messages", "store", "scripts"];
const offenders = searchRoots
  .flatMap(collectSourceFiles)
  .filter((relative) => relative !== "scripts/market-quote-unavailable-regression-checks.ts")
  .filter((relative) => /FmpOutageBanner|fmp-outage-banner/.test(read(relative)));

assert(
  offenders.length === 0,
  `No source or message file should still reference the outage banner. Found: ${offenders.join(", ")}`,
);

// 2. Neither section layout renders a banner any more.

for (const layout of [
  "app/[locale]/(full-layout)/portfolio/layout.tsx",
  "app/[locale]/(full-layout)/financial-markets/layout.tsx",
]) {
  const source = stripComments(read(layout));
  assert(
    !/Banner|Alert/.test(source),
    `${layout} should not render a section-wide banner or alert`,
  );
}

// 3. The quote-less state is information, not an incident.

const unavailable = read("components/financial-market/LiveQuoteUnavailable.tsx");
const unavailableMarkup = stripComments(unavailable);

const exportedNames = [...unavailable.matchAll(/export function (\w+)/g)].map(
  (match) => match[1],
);
assert(
  exportedNames.length > 0 &&
    exportedNames.every((name) => name.startsWith("LiveQuote")),
  `The shared quote-unavailable piece must stay provider-neutral — FMP is decommissioned. Found exports: ${exportedNames.join(", ")}`,
);

assert(
  !/role=["']alert["']/.test(unavailableMarkup),
  'A permanent product limitation is not an alert — no role="alert" on the quote-unavailable state',
);

assert(
  !/Spinner|retry|Retry|refetch|Button/.test(unavailableMarkup),
  "No spinner and no retry affordance for a quote that will not recover",
);

assert(
  !/text-(destructive|warning|success)/.test(unavailableMarkup),
  "The quote-unavailable state stays neutral — no semantic colour",
);

assert(
  /aria-hidden=["']true["']>\{MISSING_VALUE_GLYPH\}/.test(unavailableMarkup) &&
    unavailableMarkup.includes('className="sr-only"'),
  "The em dash is silent to a screen reader, so it must be hidden and paired with an accessible label",
);

assert(
  unavailableMarkup.includes('t("live-quote-unavailable")') &&
    unavailableMarkup.includes('t("live-quote-unavailable-explanation")'),
  "The quote-unavailable copy must come from the translation system, never hardcoded",
);

// 4. Both live-quote surfaces use it, and the DTO stops inventing a zero quote.

const tickerInfo = read("components/financial-market/FinancialMarketsTickerInfo.tsx");
assert(
  tickerInfo.includes("LiveQuoteUnavailableValue") &&
    tickerInfo.includes("LiveQuoteUnavailableNote"),
  "The ticker info card's price and change slots should carry the quote-unavailable treatment",
);
assert(
  !tickerInfo.includes("?? 50"),
  "The ticker info card should not colour an absent quote by defaulting it to a positive number",
);

const watchlist = read("components/financial-market/FinancialMarketsWatchlist.tsx");
assert(
  watchlist.includes("LiveQuoteUnavailableLabel"),
  "A watchlist row with no quote should say so instead of rendering a price",
);

const quoteHook = stripComments(read("lib/api/financial-markets/useTickerQuote.ts"));
assert(
  /price: number \| null/.test(quoteHook) &&
    /changePercentage: number \| null/.test(quoteHook),
  "The quote DTO must keep price and changePercentage nullable up to the UI",
);
assert(
  !/\?\?\s*0/.test(quoteHook),
  "A missing quote is not a quote of zero — no `?? 0` in the quote normaliser (DESIGN_HISTORY.md rule 3)",
);

// 5. Ticker search, price history and the company profile come out clean.

for (const clean of [
  "components/ui/TickerAutoComplete.tsx",
  "components/ui/TickerExplorerAutoComplete.tsx",
  "components/financial-market/FinancialMarketsExplorerSearch.tsx",
  "components/financial-market/FinancialMarketsTickerPrice.tsx",
  "lib/api/financial-markets/useTickerSearch.ts",
  "lib/api/financial-markets/useTickerHistoryPrice.ts",
]) {
  assert(
    !/LiveQuoteUnavailable|live-quote-unavailable/.test(read(clean)),
    `${clean} serves a working capability and must not inherit the quote-unavailable treatment`,
  );
}

// 6. Copy exists, translated, in every supported locale.

for (const locale of locales) {
  const messages = JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    unknown
  >;

  for (const key of [
    "live-quote-unavailable",
    "live-quote-unavailable-explanation",
  ]) {
    const value = messages[key];
    assert(
      typeof value === "string" && value.trim().length > 0,
      `messages/${locale}/common.json should define a non-empty "${key}"`,
    );
    if (locale !== "en") {
      const english = JSON.parse(read("messages/en/common.json")) as Record<
        string,
        unknown
      >;
      assert(
        value !== english[key],
        `messages/${locale}/common.json should translate "${key}", not copy the English string`,
      );
    }
  }

  assert(
    messages["market-data-unavailable"] !== undefined,
    `messages/${locale}/common.json should keep "market-data-unavailable" — a dozen market surfaces still use it`,
  );
}

console.log("market quote unavailable regression checks passed");
