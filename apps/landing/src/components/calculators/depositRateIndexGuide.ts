/**
 * The deposit rate index guide's content for one locale (DepositRateIndexGuide.astro): the
 * worked example's values and figures, the method's formulas and its steps as notes. Every
 * figure comes from `computeDepositBenchmark` on the worked example and from the published
 * series the page reads, so the guide never quotes other numbers than the calculator.
 */
import { Coins, PiggyBank, Receipt, TrendingDown } from "lucide-react";
import {
  DEPOSIT_RATES_EXAMPLE,
  DEPOSIT_RATES_SOURCE,
  DEPOSIT_TAX_RATE,
  computeDepositBenchmark,
  latestYearSummary,
  monthToDate,
} from "@/lib/calculators/depositRates";
import { CPI_SOURCE } from "@/lib/calculators/portugalCpi";
import { formatMoney, formatMonthYear, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the method's steps, which the formulas link to: the same in every locale. */
export const DEPOSIT_RATE_INDEX_GUIDE_IDS = {
  yearly: "deposit-rate-index-note-yearly-rate",
  inflation: "deposit-rate-index-note-inflation",
  real: "deposit-rate-index-note-real-rate",
  calculator: "deposit-rate-index-note-calculator",
} as const;

export function depositRateIndexExampleResult() {
  const outcome = computeDepositBenchmark({ ...DEPOSIT_RATES_EXAMPLE });
  if (!outcome.ok) throw new Error("The deposit-rate worked example has invalid inputs");
  return outcome.result;
}

export type DepositRateIndexGuideContent = {
  values: Record<string, string>;
  taxFlow: GuideFigure[];
  realFlow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  steps: GuideTerm[];
};

export function buildDepositRateIndexGuide(locale: Lang): DepositRateIndexGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.depositRateIndex.${key}`, values);
  const guide = (key: string) => t(`tools.depositRateIndex.guide.${key}`);
  const ids = DEPOSIT_RATE_INDEX_GUIDE_IDS;

  const example = depositRateIndexExampleResult();
  const year = latestYearSummary();
  const eur = (value: number) => formatMoney(locale, value, { currency: "EUR", decimals: 2 });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const tax = { tax: String(DEPOSIT_TAX_RATE) };

  const values = {
    amount: formatMoney(locale, DEPOSIT_RATES_EXAMPLE.amount, { currency: "EUR", decimals: 0 }),
    months: String(DEPOSIT_RATES_EXAMPLE.termMonths),
    rate: percent(example.ratePct),
    month: formatMonthYear(locale, monthToDate(example.month)),
    gross: eur(example.deposit.grossInterest),
    tax: eur(example.deposit.tax),
    net: eur(example.deposit.netInterest),
    taxRate: String(DEPOSIT_TAX_RATE),
    inflation: percent(DEPOSIT_RATES_EXAMPLE.inflation),
    inflationCost: eur(example.inflationCost),
    realGain: eur(example.realGain),
    year: String(year.year),
    yearRate: percent(year.pt),
    yearReal: percent(year.realNet),
    first: formatMonthYear(locale, monthToDate(DEPOSIT_RATES_SOURCE.firstMonth)),
    last: formatMonthYear(locale, monthToDate(DEPOSIT_RATES_SOURCE.lastMonth)),
    retrieved: DEPOSIT_RATES_SOURCE.retrievedOn,
    cpiRetrieved: CPI_SOURCE.retrieved,
    seriesPt: DEPOSIT_RATES_SOURCE.seriesPortugal.replace("{m}", "x"),
    seriesEa: DEPOSIT_RATES_SOURCE.seriesEuroArea.replace("{m}", "x"),
  };

  const taxFlow: GuideFigure[] = [
    { label: tool("result.gross"), value: values.gross, icon: Coins },
    { label: tool("result.tax", tax), value: values.tax, icon: Receipt },
    { label: tool("result.net", tax), value: values.net, icon: PiggyBank },
  ];
  const realFlow: GuideFigure[] = [
    { label: tool("result.net", tax), value: values.net, icon: PiggyBank },
    { label: tool("result.inflationCost"), value: values.inflationCost, icon: TrendingDown },
    {
      label: tool("result.realGain"),
      value: values.realGain,
      icon: Coins,
      tone: example.realGain >= 0 ? "positive" : "negative",
    },
  ];

  const f = (key: string) => guide(`method.formula.${key}`);
  const one = () => number(formatNumber(locale, 1));
  const rate = () => variable(f("rate"), ids.yearly);
  const inflation = () => variable(f("inflation"), ids.inflation);
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("realRate"), ids.real),
      expression: [fraction([one(), operator("+"), rate()], [one(), operator("+"), inflation()]), operator("−"), one()],
    },
    {
      result: variable(f("realRateAfterTax"), ids.real),
      expression: [
        fraction(
          [one(), operator("+"), rate(), operator("×"), group([one(), operator("−"), number(formatPercent(locale, DEPOSIT_TAX_RATE, { decimals: 0 }))])],
          [one(), operator("+"), inflation()],
        ),
        operator("−"),
        one(),
      ],
    },
    {
      result: variable(tool("result.inflationCost"), ids.calculator),
      expression: [
        variable(f("amount"), ids.calculator),
        operator("×"),
        group([
          group([one(), operator("+"), inflation()], [variable(f("months"), ids.calculator), operator("÷"), number(formatNumber(locale, 12))]),
          operator("−"),
          one(),
        ]),
      ],
    },
  ];

  const step = (key: string, id: string): GuideTerm => ({
    term: guide(`method.steps.${key}Term`),
    body: guide(`method.steps.${key}Body`),
    id,
  });

  return {
    values,
    taxFlow,
    realFlow,
    flowOperators: ["−", "="],
    formulas,
    steps: [step("a", ids.yearly), step("b", ids.inflation), step("c", ids.real), step("d", ids.calculator)],
  };
}
