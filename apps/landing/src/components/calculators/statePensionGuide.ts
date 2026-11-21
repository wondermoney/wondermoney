/**
 * The state pension guide's content for one locale (StatePensionGuide.astro): the worked
 * example's values and figures, the method's formulas and its notes. Every figure comes from
 * `computeStatePension` on the worked example, and every rule value from the calculator's own
 * constants, so the guide never quotes other numbers than the calculator.
 */
import { Banknote, CalendarMinus, HandCoins, Landmark, TrendingDown, Wallet } from "lucide-react";
import {
  ACCRUAL_BANDS,
  EARLY_PENALTY_PER_MONTH_BP,
  IAS_2026_CENTS,
  MINIMUM_PENSIONS_2026,
  NORMAL_AGE_2026_MONTHS,
  NORMAL_AGE_2027_MONTHS,
  STATE_PENSION_EXAMPLE,
  SUSTAINABILITY_FACTOR_2026_BP,
  computeStatePension,
} from "@/lib/calculators/statePension";
import { formatMoney } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
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
export const STATE_PENSION_GUIDE_IDS = {
  reference: "state-pension-note-reference",
  rate: "state-pension-note-rate",
  ages: "state-pension-note-ages",
  early: "state-pension-note-early",
  late: "state-pension-note-late",
  minimum: "state-pension-note-minimum",
  gap: "state-pension-note-gap",
  budget: "state-pension-note-budget",
} as const;

export function statePensionExampleResult() {
  const example = computeStatePension(STATE_PENSION_EXAMPLE);
  if (!example.ok) throw new Error("Invalid state pension worked example");
  return example.result;
}

export type StatePensionGuideContent = {
  values: Record<string, string>;
  pensionFlow: GuideFigure[];
  pensionOperators: GuideFlowOperator[];
  gapFlow: GuideFigure[];
  gapOperators: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildStatePensionGuide(locale: Lang): StatePensionGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.statePension.${key}`, values);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.statePension.guide.${key}`, values);
  const ids = STATE_PENSION_GUIDE_IDS;

  const result = statePensionExampleResult();
  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const decimal = (value: number, digits = 2) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const age = (months: number) => tool("ageValue", { years: String(Math.floor(months / 12)), months: String(months % 12) });

  const values = {
    gross: formatMoney(locale, STATE_PENSION_EXAMPLE.grossMonthly, { decimals: 0 }),
    years: String(STATE_PENSION_EXAMPLE.years),
    age: age(STATE_PENSION_EXAMPLE.ageYears * 12 + STATE_PENSION_EXAMPLE.ageMonths),
    statutory: money(result.statutoryCents),
    rate: `${decimal(result.globalRateBp / 100)}%`,
    months: String(result.adjustmentMonths),
    penalty: `${decimal(result.penaltyBp / 100)}%`,
    monthly: money(result.monthlyCents),
    replacement: `${decimal(result.replacementBp / 100, 1)}%`,
    net: money(result.netPayCents),
    netPension: money(result.netPensionCents),
    gap: money(result.gapCents),
  };

  /** The rule values the method's notes quote. */
  const limitValues = {
    ias: money(IAS_2026_CENTS),
    normal2026: age(NORMAL_AGE_2026_MONTHS),
    normal2027: age(NORMAL_AGE_2027_MONTHS),
    factor: decimal(SUSTAINABILITY_FACTOR_2026_BP / 10_000, 4),
    penalty: `${decimal(EARLY_PENALTY_PER_MONTH_BP / 100, 1)}%`,
    rates: ACCRUAL_BANDS.map((band) => `${decimal(band.rateBp / 100)}%`).join(", "),
    min15: money(MINIMUM_PENSIONS_2026[2].cents),
    min21: money(MINIMUM_PENSIONS_2026[1].cents),
    min31: money(MINIMUM_PENSIONS_2026[0].cents),
  };

  const pensionFlow: GuideFigure[] = [
    { label: tool("result.statutory"), value: values.statutory, icon: Landmark, detail: `${values.rate} × ${values.gross}` },
    {
      label: tool("result.monthly"),
      value: values.monthly,
      icon: CalendarMinus,
      detail: `× (1 − ${values.penalty}) × ${limitValues.factor}`,
    },
    { label: tool("result.netPension"), value: values.netPension, icon: HandCoins },
  ];

  const gapFlow: GuideFigure[] = [
    { label: tool("result.netPay"), value: values.net, icon: Wallet },
    { label: tool("result.netPension"), value: values.netPension, icon: Banknote },
    { label: tool("result.gap"), value: values.gap, icon: TrendingDown, tone: "negative" },
  ];

  const f = (key: string) => guide(`formula.${key}`);
  const one = () => number("1");
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(f("globalRate"), ids.rate),
      expression: [variable(f("annualRate"), ids.rate), operator("×"), variable(f("years"), ids.rate)],
    },
    {
      result: variable(f("statutory"), ids.reference),
      expression: [variable(f("reference"), ids.reference), operator("×"), variable(f("globalRateLower"), ids.rate)],
    },
    {
      result: variable(f("earlyPension"), ids.early),
      expression: [
        variable(f("statutoryLower"), ids.minimum),
        operator("×"),
        group([one(), operator("−"), variable(f("monthsEarly"), ids.ages), operator("×"), number(limitValues.penalty)]),
        operator("×"),
        variable(f("factor"), ids.early),
      ],
    },
    {
      result: variable(f("gap"), ids.gap),
      expression: [variable(f("netPay"), ids.gap), operator("−"), variable(f("netPension"), ids.gap)],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, limitValues),
    id,
  });

  return {
    values,
    pensionFlow,
    pensionOperators: ["→", "→"],
    gapFlow,
    gapOperators: ["−", "="],
    formulas,
    notes: [
      note("methodReference", ids.reference),
      note("methodRate", ids.rate),
      note("methodAges", ids.ages),
      note("methodEarly", ids.early),
      note("methodLate", ids.late),
      note("methodMinimum", ids.minimum),
      note("methodGap", ids.gap),
      note("methodBudget", ids.budget),
    ],
  };
}
