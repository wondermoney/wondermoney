/**
 * The compound interest guide's content for one locale (CompoundInterestGuide.astro): the
 * worked example's values and figures, the method's formulas and its notes. Every figure
 * comes from `compareContributions` on the calculator's starting values, so the guide can
 * never quote other numbers than the calculator shows.
 */
import { Coins, Sprout, TrendingUp, Wallet } from "lucide-react";
import {
  EXAMPLE_INPUTS,
  MAX_AMOUNT,
  MAX_RATE,
  MAX_YEARS,
  compareContributions,
  defaultComparisonContribution,
  effectiveAnnualRate,
} from "@/lib/calculators/compoundInterest";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
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

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const COMPOUND_INTEREST_GUIDE_IDS = {
  monthly: "compound-interest-note-monthly",
  inflation: "compound-interest-note-inflation",
  rounding: "compound-interest-note-rounding",
  ranges: "compound-interest-note-ranges",
  privacy: "compound-interest-note-privacy",
} as const;

export type CompoundInterestGuideContent = {
  /** Values for the example's and the method's sentences. */
  values: Record<string, string | number>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildCompoundInterestGuide(locale: Lang): CompoundInterestGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.compoundInterest.${key}`);
  const guide = (key: string, values?: Record<string, string | number>) =>
    t(`tools.compoundInterest.guide.${key}`, values);
  const ids = COMPOUND_INTEREST_GUIDE_IDS;
  const money = (value: number) => formatMoney(locale, value);
  const percent = (value: number, decimals = 0) => formatPercent(locale, value, { decimals });

  const comparisonContribution = defaultComparisonContribution(EXAMPLE_INPUTS.monthlyContribution);
  const { current, comparison, difference } = compareContributions(EXAMPLE_INPUTS, comparisonContribution);
  if (!current.nominal || !current.real || !comparison.nominal || !comparison.real || !difference) {
    throw new Error("The compound interest worked example must produce figures");
  }

  const values = {
    principal: money(EXAMPLE_INPUTS.principal),
    monthly: money(EXAMPLE_INPUTS.monthlyContribution),
    months: formatNumber(locale, EXAMPLE_INPUTS.years * 12),
    rate: percent(EXAMPLE_INPUTS.annualRate),
    effectiveRate: percent(effectiveAnnualRate(EXAMPLE_INPUTS.annualRate), 2),
    inflation: percent(EXAMPLE_INPUTS.inflationRate),
    years: formatNumber(locale, EXAMPLE_INPUTS.years),
    contributed: money(current.nominal.contributed),
    growth: money(current.nominal.growth),
    final: money(current.nominal.finalValue),
    realContributed: money(current.real.contributed),
    realGrowth: money(current.real.growth),
    realFinal: money(current.real.finalValue),
    comparisonMonthly: money(comparison.inputs.monthlyContribution),
    extraContributed: money(difference.nominal.contributed),
    extraFinal: money(difference.nominal.finalValue),
    extraReal: money(difference.real.finalValue),
    comparisonFinal: money(comparison.nominal.finalValue),
    maxAmount: money(MAX_AMOUNT),
    maxRate: MAX_RATE,
    maxYears: MAX_YEARS,
  };

  const flow: GuideFigure[] = [
    { label: tool("totalContributions"), value: values.contributed, icon: Wallet },
    { label: tool("totalInterest"), value: values.growth, icon: Sprout, tone: "positive" },
    { label: tool("finalBalance"), value: values.final, icon: TrendingUp },
    { label: tool("finalValueReal"), value: values.realFinal, icon: Coins },
  ];

  const annualReturn = () => variable(guide("formulaAnnualReturn"), ids.monthly);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(guide("formulaBalanceEnd"), ids.monthly),
      expression: [
        variable(guide("formulaBalanceStart"), ids.monthly),
        operator("×"),
        group([one(), operator("+"), fraction([annualReturn()], [number(formatNumber(locale, 12))])]),
        operator("+"),
        variable(guide("formulaContribution"), ids.monthly),
      ],
    },
    {
      result: variable(guide("formulaRealValue"), ids.inflation),
      expression: [
        fraction(
          [variable(guide("formulaValue"), ids.rounding)],
          [
            group(
              [one(), operator("+"), variable(guide("formulaInflation"), ids.inflation)],
              [variable(guide("formulaYears"), ids.ranges)],
            ),
          ],
        ),
      ],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, values),
    id,
  });

  return {
    values,
    flow,
    flowOperators: ["+", "=", "→"],
    formulas,
    notes: [
      note("methodMonthly", ids.monthly),
      note("methodInflation", ids.inflation),
      note("methodRounding", ids.rounding),
      note("methodRanges", ids.ranges),
      note("methodPrivacy", ids.privacy),
    ],
  };
}
