/**
 * The emergency fund guide's content for one locale (EmergencyFundMethod.astro): the worked
 * example's figures and the method's formulas with their notes. Every figure comes from
 * `computeEmergencyFund` on the example the calculator starts from, so the guide can never
 * quote other numbers than the calculator shows.
 */
import { CalendarClock, PiggyBank, Target } from "lucide-react";
import { EXAMPLE_INPUTS, GUIDANCE_RANGE_MONTHS, computeEmergencyFund } from "@/lib/calculators/emergencyFund";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const EMERGENCY_FUND_GUIDE_IDS = {
  expenses: "emergency-fund-note-expenses",
  months: "emergency-fund-note-months",
  savings: "emergency-fund-note-savings",
  contribution: "emergency-fund-note-contribution",
  shortfall: "emergency-fund-note-shortfall",
  time: "emergency-fund-note-time",
  interest: "emergency-fund-note-interest",
} as const;

export type EmergencyFundGuideContent = {
  /** Values for the example's paragraphs (`exampleIntro`, `exampleOutro`). */
  exampleValues: Record<string, string | number>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildEmergencyFundGuide(locale: Lang): EmergencyFundGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.emergencyFund.${key}`);
  const ids = EMERGENCY_FUND_GUIDE_IDS;

  const example = computeEmergencyFund(EXAMPLE_INPUTS);
  const lowCover = computeEmergencyFund({ ...EXAMPLE_INPUTS, monthsOfCover: GUIDANCE_RANGE_MONTHS[0] });
  const money = (value: number) => formatMoney(locale, value, { decimals: Number.isInteger(value) ? 0 : 2 });
  const months = (count: number) =>
    count === 1 ? tool("monthsCountOne") : t("tools.emergencyFund.monthsCount", { count: formatNumber(locale, count) });

  const exampleValues = {
    expenses: money(EXAMPLE_INPUTS.monthlyExpenses),
    savings: money(EXAMPLE_INPUTS.currentSavings),
    contribution: money(EXAMPLE_INPUTS.monthlyContribution),
    months: example.monthsOfCover,
    target: money(example.target),
    shortfall: money(example.shortfall),
    monthsToTarget: example.monthsToTarget ?? 0,
    lowTarget: money(lowCover.target),
    lowMonths: lowCover.monthsToTarget ?? 0,
  };

  const flow: GuideFigure[] = [
    {
      label: tool("target"),
      value: exampleValues.target,
      icon: Target,
      detail: `${exampleValues.expenses} × ${formatNumber(locale, example.monthsOfCover)}`,
    },
    {
      label: tool("shortfall"),
      value: exampleValues.shortfall,
      icon: PiggyBank,
      detail: `${exampleValues.target} − ${exampleValues.savings}`,
    },
    {
      label: tool("monthsToTarget"),
      value: months(example.monthsToTarget ?? 0),
      icon: CalendarClock,
      detail: `${exampleValues.shortfall} ÷ ${exampleValues.contribution}`,
    },
  ];

  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("target")),
      expression: [
        variable(tool("monthlyExpenses"), ids.expenses),
        operator("×"),
        variable(tool("monthsOfCover"), ids.months),
      ],
    },
    {
      result: variable(tool("shortfall"), ids.shortfall),
      expression: [variable(tool("target")), operator("−"), variable(tool("currentSavings"), ids.savings)],
    },
    {
      result: variable(tool("monthsToTarget"), ids.time),
      expression: [
        fraction([variable(tool("shortfall"), ids.shortfall)], [variable(tool("monthlyContribution"), ids.contribution)]),
      ],
    },
  ];

  // The calculator's own help lines explain its inputs; the method adds the rest.
  const notes: GuideTerm[] = [
    { term: tool("monthlyExpenses"), body: tool("monthlyExpensesHelp"), id: ids.expenses },
    { term: tool("monthsOfCover"), body: tool("guidanceRangeGeneric"), id: ids.months },
    { term: tool("currentSavings"), body: tool("currentSavingsHelp"), id: ids.savings },
    { term: tool("monthlyContribution"), body: tool("monthlyContributionHelp"), id: ids.contribution },
    { term: tool("shortfall"), body: tool("methodShortfallBody"), id: ids.shortfall },
    { term: tool("monthsToTarget"), body: tool("methodTimeBody"), id: ids.time },
    { term: tool("methodInterestTerm"), body: tool("methodInterestBody"), id: ids.interest },
  ];

  return { exampleValues, flow, flowOperators: ["→", "→"], formulas, notes };
}
