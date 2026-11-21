/**
 * The FIRE guide's content for one locale (FireGuide.astro): the worked example's values and
 * figures, the method's formulas and its notes. Every figure comes from `calculateFire` on the
 * worked example the calculator starts from, formatted as the calculator formats it.
 */
import { CalendarClock, Flag, Gauge, Percent, Wallet } from "lucide-react";
import {
  FIRE_MAX_YEARS,
  FIRE_SPENDING_CUT,
  FIRE_WORKED_EXAMPLE,
  calculateFire,
  withSpendingCut,
  type FireResult,
} from "@/lib/calculators/fire";
import { formatFireDuration, formatFireProgress, formatFireRate } from "@/lib/calculators/fireFormat";
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
export const FIRE_GUIDE_IDS = {
  multiple: "fire-note-withdrawal-rate",
  growth: "fire-note-growth",
  realMoney: "fire-note-real-money",
  horizon: "fire-note-horizon",
  leftOut: "fire-note-left-out",
  privacy: "fire-note-privacy",
} as const;

/** The worked example and the same with FIRE_SPENDING_CUT less spending. */
export function fireExampleResults(): { result: FireResult; cut: FireResult } {
  const result = calculateFire(FIRE_WORKED_EXAMPLE);
  const cut = calculateFire(withSpendingCut(FIRE_WORKED_EXAMPLE));
  // The worked example is fixed, so a change to the calculation that stops it projecting a
  // date has to fail the build rather than print an empty sentence.
  if (result.monthsToTarget === null || cut.monthsToTarget === null || result.progress === null) {
    throw new Error("The FIRE worked example no longer reaches its target");
  }
  return { result, cut };
}

export type FireGuideContent = {
  values: Record<string, string>;
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  outcome: GuideFigure[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildFireGuide(locale: Lang): FireGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.fire.${key}`);
  const guide = (key: string, values?: Record<string, string | number>) => t(`tools.fire.guide.${key}`, values);
  const ids = FIRE_GUIDE_IDS;

  const example = FIRE_WORKED_EXAMPLE;
  const { result, cut } = fireExampleResults();
  const money = (value: number) => formatMoney(locale, value);
  // The same formatters as the calculator, so the example reads exactly like its result.
  const rate = (value: number) => formatFireRate(locale, value);

  const values = {
    spending: money(example.annualSpending),
    assets: money(example.currentAssets),
    contribution: money(example.monthlyContribution),
    return: rate(example.realReturn),
    rate: rate(example.withdrawalRate),
    target: money(result.fireNumber),
    progress: formatFireProgress(locale, result.progress ?? 0),
    time: formatFireDuration(locale, result.monthsToTarget ?? 0),
    cut: formatPercent(locale, FIRE_SPENDING_CUT, { decimals: 0 }),
    cutSpending: money(cut.inputs.annualSpending),
    cutTarget: money(cut.fireNumber),
    cutTime: formatFireDuration(locale, cut.monthsToTarget ?? 0),
  };

  const flow: GuideFigure[] = [
    { label: tool("annualSpending"), value: values.spending, icon: Wallet },
    { label: tool("withdrawalRate"), value: values.rate, icon: Percent },
    { label: tool("fireNumber"), value: values.target, icon: Flag },
  ];

  const outcome: GuideFigure[] = [
    {
      label: tool("progress"),
      value: values.progress,
      icon: Gauge,
      share: result.progress,
      detail: `${values.assets} ÷ ${values.target}`,
    },
    { label: tool("timeToFire"), value: values.time, text: true, icon: CalendarClock },
  ];

  const f = (key: string) => guide(`formula.${key}`);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("fireNumber"), ids.multiple),
      expression: [
        fraction([variable(f("annualSpending"), ids.realMoney)], [variable(f("withdrawalRate"), ids.multiple)]),
      ],
    },
    {
      result: variable(f("monthlyRate"), ids.growth),
      expression: [
        group(
          [one(), operator("+"), variable(f("realReturn"), ids.realMoney)],
          [one(), operator("÷"), number(formatNumber(locale, 12))],
        ),
        operator("−"),
        one(),
      ],
    },
    {
      result: variable(f("assetsEnd"), ids.growth),
      expression: [
        variable(f("assetsStart"), ids.horizon),
        operator("×"),
        group([one(), operator("+"), variable(f("monthlyRateLower"), ids.growth)]),
        operator("+"),
        variable(f("contribution"), ids.realMoney),
      ],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, { years: FIRE_MAX_YEARS }),
    id,
  });

  return {
    values,
    flow,
    flowOperators: ["÷", "="],
    outcome,
    formulas,
    notes: [
      note("methodMultiple", ids.multiple),
      note("methodGrowth", ids.growth),
      note("methodRealMoney", ids.realMoney),
      note("methodHorizon", ids.horizon),
      note("methodLeftOut", ids.leftOut),
      note("methodPrivacy", ids.privacy),
    ],
  };
}
