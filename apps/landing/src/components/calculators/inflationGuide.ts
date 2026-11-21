/**
 * The inflation guide's content for one locale (InflationGuide.astro): the worked example's
 * values and figures, and the method's formulas. Every figure comes from `computeInflation`
 * on the example the calculator starts from.
 */
import { Receipt, ShoppingBasket, TrendingDown, Wallet } from "lucide-react";
import { INFLATION_EXAMPLE, computeInflation } from "@/lib/calculators/inflation";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import { fraction, operator, variable, type GuideFigure, type GuideFormulaLine } from "./guideBlocks";

export type InflationGuideContent = {
  /** Values for the example's paragraphs (`exampleBudget`, `exampleInvestment`). */
  values: Record<string, string | number>;
  /** The budget's buying power: the amount then, and what buys the same later. */
  budget: GuideFigure[];
  /** The balance later, and what it is worth in the starting year's euros. */
  investment: GuideFigure[];
  formulas: GuideFormulaLine[];
};

export function buildInflationGuide(locale: Lang): InflationGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, year: number) => t(`tools.inflation.${key}`, { year });
  const guide = (key: string) => t(`tools.inflation.guide.${key}`);

  const example = computeInflation(INFLATION_EXAMPLE);
  if (!example || example.realValue === null) throw new Error("Invalid inflation worked example");

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const values = {
    ...INFLATION_EXAMPLE,
    amount: money(INFLATION_EXAMPLE.amount),
    finalValue: money(INFLATION_EXAMPLE.finalValue),
    equivalent: money(example.equivalent),
    realValue: money(example.realValue),
    inflation: formatPercent(locale, example.priceChange, { decimals: 2 }),
  };
  const { from, to } = INFLATION_EXAMPLE;

  const budget: GuideFigure[] = [
    { label: tool("amount", from), value: values.amount, icon: Wallet },
    {
      label: tool("equivalent", to),
      value: values.equivalent,
      icon: ShoppingBasket,
      detail: formatPercent(locale, example.priceChange, { decimals: 2, sign: "always" }),
    },
  ];
  const investment: GuideFigure[] = [
    { label: tool("finalValue", to), value: values.finalValue, icon: Receipt },
    { label: tool("realValue", from), value: values.realValue, icon: TrendingDown },
  ];

  const cpiStart = () => variable(guide("formulaCpiStart"));
  const cpiComparison = () => variable(guide("formulaCpiComparison"));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(guide("formulaEquivalent")),
      expression: [variable(guide("formulaAmount")), operator("×"), fraction([cpiComparison()], [cpiStart()])],
    },
    {
      result: variable(guide("formulaReal")),
      expression: [variable(guide("formulaFinal")), operator("×"), fraction([cpiStart()], [cpiComparison()])],
    },
  ];

  return { values, budget, investment, formulas };
}
