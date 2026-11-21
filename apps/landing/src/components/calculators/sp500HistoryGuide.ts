/**
 * The S&P 500 history guide's content for one locale (Sp500HistoryGuide.astro): the worked
 * example's values and figures and the "what these figures leave out" terms. Every figure
 * comes from `computeSp500History` on the worked example, run the way the calculator runs it.
 */
import { ChartNoAxesCombined, ChartSpline, Coins, TrendingDown, TrendingUp } from "lucide-react";
import {
  SP500_HISTORY_EXAMPLE,
  SP500_HISTORY_LIMITS,
  SP500_HISTORY_SOURCE,
  computeSp500History,
} from "@/lib/calculators/sp500History";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure, GuideTerm } from "./guideBlocks";

export function sp500ExampleResults() {
  const calculate = (overrides: Partial<typeof SP500_HISTORY_EXAMPLE>) => {
    const outcome = computeSp500History({ ...SP500_HISTORY_EXAMPLE, ...overrides });
    if (!outcome.ok) throw new Error("The S&P 500 history worked example has invalid inputs");
    return outcome.result;
  };
  return {
    total: calculate({}),
    priceOnly: calculate({ reinvestDividends: false }),
    real: calculate({ inflationAdjusted: true }),
  };
}

export type Sp500HistoryGuideContent = {
  values: Record<string, string>;
  figures: GuideFigure[];
  limits: GuideTerm[];
  /** The last limit, a sentence without a term. */
  limitsNote: string;
};

export function buildSp500HistoryGuide(locale: Lang): Sp500HistoryGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.sp500History.${key}`, values);
  const guide = (key: string) => t(`tools.sp500History.guide.${key}`);
  const { total, priceOnly, real } = sp500ExampleResults();

  const usd = (value: number) => formatMoney(locale, value, { currency: "USD", decimals: 0 });
  const percent = (value: number, sign: "auto" | "always" = "always") =>
    formatPercent(locale, value, { decimals: 1, sign });
  const start = String(SP500_HISTORY_EXAMPLE.startYear);
  const values = {
    start,
    end: String(SP500_HISTORY_EXAMPLE.endYear),
    years: String(total.years.length),
    initial: usd(SP500_HISTORY_EXAMPLE.initial),
    finalTotal: usd(total.finalValue),
    cagrTotal: percent(total.cagrPct),
    finalPrice: usd(priceOnly.finalValue),
    cagrPrice: percent(priceOnly.cagrPct),
    finalReal: usd(real.finalValue),
    cagrReal: percent(real.cagrPct),
    worstYear: String(total.worst.year),
    worstReturn: percent(total.worst.returnPct),
    bestYear: String(total.best.year),
    bestReturn: percent(total.best.returnPct),
    first: String(SP500_HISTORY_LIMITS.firstYear),
    last: String(SP500_HISTORY_LIMITS.lastYear),
    downloaded: SP500_HISTORY_SOURCE.returns.downloadedOn,
    shillerDownloaded: SP500_HISTORY_SOURCE.inflation.downloadedOn,
    maxAmount: usd(SP500_HISTORY_LIMITS.maxAmount),
  };

  // The calculator's own phrases for each basis, as card labels; its acronym for the CAGR.
  const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  const cagr = tool("result.cagr").split(" (")[0];
  const figures: GuideFigure[] = [
    {
      label: capitalize(tool("result.basisTotal")),
      value: values.finalTotal,
      icon: TrendingUp,
      detail: `${cagr} ${values.cagrTotal}`,
    },
    {
      label: capitalize(tool("result.basisPrice")),
      value: values.finalPrice,
      icon: ChartSpline,
      detail: `${cagr} ${values.cagrPrice}`,
    },
    {
      label: capitalize(tool("result.termsReal", { year: start })),
      value: values.finalReal,
      icon: Coins,
      detail: `${cagr} ${values.cagrReal}`,
    },
    {
      label: tool("result.best"),
      value: values.bestReturn,
      icon: ChartNoAxesCombined,
      detail: values.bestYear,
      tone: "positive",
    },
    {
      label: tool("result.worst"),
      value: values.worstReturn,
      icon: TrendingDown,
      detail: values.worstYear,
      tone: "negative",
    },
  ];

  const limit = (key: string): GuideTerm => ({
    term: guide(`limits.items.${key}Term`),
    body: guide(`limits.items.${key}Body`),
  });

  return {
    values,
    figures,
    limits: [limit("fx"), limit("fees"), limit("taxes"), limit("sequence")],
    limitsNote: guide("limits.items.past"),
  };
}
