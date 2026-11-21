/**
 * The savings goal guide's content for one locale (SavingsGoalGuide.astro): the worked
 * example's values and figures, and the method's formulas with their notes. Every figure
 * comes from `computeSavingsGoal` on the example the calculator starts from.
 */
import { Coins, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import {
  SAVINGS_GOAL_EXAMPLE,
  SAVINGS_GOAL_LIMITS,
  computeSavingsGoal,
  type SavingsGoalInput,
  type SavingsGoalResult,
} from "@/lib/calculators/savingsGoal";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  number,
  operator,
  group,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideFormulaPart,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const SAVINGS_GOAL_GUIDE_IDS = {
  rate: "savings-goal-note-rate",
  zero: "savings-goal-note-zero-return",
  rounding: "savings-goal-note-rounding",
  contribution: "savings-goal-note-contribution",
  time: "savings-goal-note-time",
} as const;

export type SavingsGoalGuideContent = {
  /** Values for the example's and the method's strings. */
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

function calculate(overrides: Partial<SavingsGoalInput>): SavingsGoalResult {
  const calculation = computeSavingsGoal({ ...SAVINGS_GOAL_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error("The savings goal worked example has invalid inputs");
  return calculation.result;
}

export function buildSavingsGoalGuide(locale: Lang): SavingsGoalGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.savingsGoal.${key}`);
  const guide = (key: string, params?: Record<string, string>) => t(`tools.savingsGoal.guide.${key}`, params);
  const ids = SAVINGS_GOAL_GUIDE_IDS;

  const example = calculate({});
  const savingsAlone = calculate({ solveFor: "finalAmount", monthlyContribution: 0 });
  const time = calculate({ solveFor: "time" });
  const final = calculate({ solveFor: "finalAmount" });

  const money = (value: number) => formatMoney(locale, value, { decimals: Number.isInteger(value) ? 0 : 2 });
  const periodMonths = SAVINGS_GOAL_EXAMPLE.years * 12 + SAVINGS_GOAL_EXAMPLE.months;

  const values = {
    goal: money(SAVINGS_GOAL_EXAMPLE.goalAmount),
    savings: money(SAVINGS_GOAL_EXAMPLE.startingSavings),
    years: formatNumber(locale, SAVINGS_GOAL_EXAMPLE.years),
    months: formatNumber(locale, periodMonths),
    rate: formatPercent(locale, SAVINGS_GOAL_EXAMPLE.annualReturn, { decimals: 0 }),
    monthlyRate: formatPercent(locale, example.monthlyRate, { decimals: 4 }),
    savingsAlone: money(savingsAlone.finalBalance),
    gap: money(SAVINGS_GOAL_EXAMPLE.goalAmount - savingsAlone.finalBalance),
    contribution: money(example.monthlyContribution),
    contributions: money(example.totalContributions),
    growth: money(example.totalGrowth),
    final: money(example.finalBalance),
    rounded: money(SAVINGS_GOAL_EXAMPLE.monthlyContribution),
    timeMonths: formatNumber(locale, time.months ?? 0),
    finalAmount: money(final.finalBalance),
    maxAmount: money(SAVINGS_GOAL_LIMITS.maxAmount),
    maxReturn: formatPercent(locale, SAVINGS_GOAL_LIMITS.maxAnnualReturn, { decimals: 0 }),
    maxYears: formatNumber(locale, SAVINGS_GOAL_LIMITS.maxMonths / 12),
  };

  // Already saved + contributions + growth = final balance, as on the calculator's ledger.
  const flow: GuideFigure[] = [
    { label: tool("startingSavings"), value: money(SAVINGS_GOAL_EXAMPLE.startingSavings), icon: Wallet },
    {
      label: tool("totalContributions"),
      value: values.contributions,
      icon: Coins,
      detail: `${values.months} × ${values.contribution}`,
    },
    { label: tool("totalGrowth"), value: values.growth, icon: TrendingUp, tone: "positive" },
    { label: tool("finalBalance"), value: values.final, icon: PiggyBank },
  ];

  const one = number(formatNumber(locale, 1));
  const monthlyRate = () => variable(guide("formulaMonthlyRate"), ids.rate);
  const months = () => variable(tool("periodMonths"), ids.time);
  const growthFactor = (): GuideFormulaPart => group([one, operator("+"), monthlyRate()], [months()]);
  const formulas: GuideFormulaLine[] = [
    {
      result: monthlyRate(),
      expression: [
        group([one, operator("+"), variable(tool("annualReturn"))], [number(`${formatNumber(locale, 1)}/${formatNumber(locale, 12)}`)]),
        operator("−"),
        one,
      ],
    },
    {
      result: variable(tool("finalBalance")),
      expression: [
        variable(tool("startingSavings")),
        operator("×"),
        growthFactor(),
        operator("+"),
        variable(tool("monthlyContribution"), ids.contribution),
        operator("×"),
        fraction([growthFactor(), operator("−"), one], [monthlyRate()]),
      ],
    },
  ];

  const notes: GuideTerm[] = [
    { term: guide("formulaMonthlyRate"), body: guide("methodRateBody"), id: ids.rate },
    { term: guide("methodZeroTerm"), body: guide("methodZeroBody"), id: ids.zero },
    { term: guide("methodOrderTerm"), body: guide("methodOrderBody"), id: ids.rounding },
    { term: tool("answer.contribution"), body: guide("methodContributionBody"), id: ids.contribution },
    { term: tool("answer.time"), body: guide("methodTimeBody", values), id: ids.time },
  ];

  return { values, flow, flowOperators: ["+", "+", "="], formulas, notes };
}
