/**
 * The content of the Segurança Social and termination guides for one locale: unemployment
 * benefit (UnemploymentBenefitGuide.astro), sick pay (SickPayGuide.astro) and dismissal
 * compensation (DismissalCompensationGuide.astro). Each worked example's figures come from the
 * calculator's own function on the example it starts from; the method notes are the guides'
 * own strings, each under a term, and the formulas link to them.
 */
import { CalendarDays, Coins, Landmark, TrendingDown, Wallet } from "lucide-react";
import {
  DISMISSAL_EXAMPLE,
  RMMG_2026_CENTS as DISMISSAL_RMMG_CENTS,
  computeDismissalCompensation,
} from "@/lib/calculators/dismissalCompensation";
import {
  MIN_DAILY_CENTS,
  RMMG_2026_CENTS as SICK_RMMG_CENTS,
  SICK_PAY_EXAMPLE,
  computeSickPay,
  floorDailyCents,
} from "@/lib/calculators/sickPay";
import {
  IAS_2026_CENTS,
  MAX_IAS_HUNDREDTHS,
  RMMG_2026_CENTS as UNEMPLOYMENT_RMMG_CENTS,
  UNEMPLOYMENT_EXAMPLE,
  computeUnemploymentBenefit,
} from "@/lib/calculators/unemploymentBenefit";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

const centsToMoney = (locale: Lang) => (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });

export type BenefitGuideContent = {
  /** Values for the example's paragraph. */
  values: Record<string, string>;
  /** Values for the method notes that quote limits. */
  limitValues: Record<string, string>;
  figures: GuideFigure[];
  /** Set for a flow; a grid has none. */
  flowOperators?: GuideFlowOperator[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const UNEMPLOYMENT_GUIDE_IDS = {
  reference: "unemployment-note-reference",
  amount: "unemployment-note-amount",
  limits: "unemployment-note-limits",
  net: "unemployment-note-net",
  increase: "unemployment-note-increase",
  duration: "unemployment-note-duration",
  noReduction: "unemployment-note-no-reduction",
  tax: "unemployment-note-tax",
  budget: "unemployment-note-budget",
} as const;

export function buildUnemploymentGuide(locale: Lang): BenefitGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.unemploymentBenefit.${key}`);
  const guide = (key: string, params?: Record<string, string>) => t(`tools.unemploymentBenefit.guide.${key}`, params);
  const ids = UNEMPLOYMENT_GUIDE_IDS;
  const example = computeUnemploymentBenefit(UNEMPLOYMENT_EXAMPLE);
  if (!example.ok) throw new Error("Invalid unemployment benefit worked example");

  const money = centsToMoney(locale);
  const { result } = example;
  const values = {
    age: String(UNEMPLOYMENT_EXAMPLE.age),
    gross: formatMoney(locale, UNEMPLOYMENT_EXAMPLE.grossMonthly, { decimals: 0 }),
    months: String(UNEMPLOYMENT_EXAMPLE.contributionMonths),
    years: String(UNEMPLOYMENT_EXAMPLE.years20),
    reference: money(result.referenceDailyCents),
    monthly: money(result.monthlyCents),
    daily: money(result.dailyCents),
    base: String(result.duration.baseDays),
    extra: String(result.duration.extraDays),
    days: String(result.duration.totalDays),
    total: money(result.totalCents),
    net: money(result.netReferenceMonthlyCents),
    drop: money(result.monthlyDropCents),
  };
  const limitValues = {
    max: money(Math.round((IAS_2026_CENTS * MAX_IAS_HUNDREDTHS) / 100)),
    ias: money(IAS_2026_CENTS),
    rmmg: money(UNEMPLOYMENT_RMMG_CENTS),
  };

  const figures: GuideFigure[] = [
    { label: tool("result.monthly"), value: values.monthly, icon: Wallet },
    {
      label: tool("result.total"),
      value: values.total,
      icon: CalendarDays,
      detail: `${values.monthly} × ${values.days} ÷ 30`,
    },
    {
      label: tool("result.drop"),
      value: `−${values.drop}`,
      icon: TrendingDown,
      detail: `${values.net} − ${values.monthly}`,
      tone: "negative",
    },
  ];

  const reference = () => variable(guide("formulaReference"), ids.reference);
  const daily = () => variable(guide("formulaDaily"), ids.amount);
  const formulas: GuideFormulaLine[] = [
    {
      result: reference(),
      expression: [fraction([variable(guide("formulaPay"), ids.reference)], [number(formatNumber(locale, 360))])],
    },
    {
      result: daily(),
      expression: [number(formatPercent(locale, 65, { decimals: 0 })), operator("×"), reference()],
    },
    {
      result: variable(guide("formulaMonthly"), ids.limits),
      expression: [number(formatNumber(locale, 30)), operator("×"), daily()],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({ term: guide(`${key}Term`), body: guide(key, limitValues), id });
  const notes: GuideTerm[] = [
    note("methodReference", ids.reference),
    note("methodAmount", ids.amount),
    note("methodLimits", ids.limits),
    note("methodNet", ids.net),
    note("methodIncrease", ids.increase),
    note("methodDuration", ids.duration),
    note("methodNoReduction", ids.noReduction),
    note("methodTax", ids.tax),
    note("methodBudget", ids.budget),
  ];

  return { values, limitValues, figures, formulas, notes };
}

export const SICK_PAY_GUIDE_IDS = {
  reference: "sick-pay-note-reference",
  bands: "sick-pay-note-bands",
  waiting: "sick-pay-note-waiting",
  minimum: "sick-pay-note-minimum",
  increase: "sick-pay-note-increase",
  floor: "sick-pay-note-floor",
  netCap: "sick-pay-note-net-cap",
  gap: "sick-pay-note-gap",
  budget: "sick-pay-note-budget",
} as const;

export function buildSickPayGuide(locale: Lang): BenefitGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, params?: Record<string, string>) => t(`tools.sickPay.${key}`, params);
  const guide = (key: string, params?: Record<string, string>) => t(`tools.sickPay.guide.${key}`, params);
  const ids = SICK_PAY_GUIDE_IDS;
  const example = computeSickPay(SICK_PAY_EXAMPLE);
  if (!example.ok) throw new Error("Invalid sick pay worked example");

  const money = centsToMoney(locale);
  const { result } = example;
  const values = {
    gross: formatMoney(locale, SICK_PAY_EXAMPLE.grossMonthly, { decimals: 0 }),
    days: String(SICK_PAY_EXAMPLE.sickDays),
    reference: money(result.referenceDailyCents),
    total: money(result.totalCents),
    net: money(result.netMonthlyCents),
    gap: money(result.averageMonthlyGapCents),
  };
  const limitValues = {
    min: money(MIN_DAILY_CENTS),
    rmmg: money(SICK_RMMG_CENTS),
    floor55: money(floorDailyCents(55)),
    floor60: money(floorDailyCents(60)),
  };

  // Each band of the leave, then the total they add up to.
  const bands: GuideFigure[] = result.bands.map((band) => ({
    label: tool("result.bandLabel", { from: String(band.fromDay), to: String(band.toDay), percent: String(band.percent) }),
    value: money(band.amountCents),
    icon: Coins,
    detail: `${band.paidDays} × ${money(band.dailyCents)}`,
  }));
  const figures: GuideFigure[] = [...bands, { label: tool("result.total"), value: values.total, icon: Wallet }];
  const flowOperators: GuideFlowOperator[] = [...bands.slice(1).map(() => "+" as const), "="];

  const reference = () => variable(guide("formulaReference"), ids.reference);
  const formulas: GuideFormulaLine[] = [
    {
      result: reference(),
      expression: [fraction([variable(guide("formulaPay"), ids.reference)], [number(formatNumber(locale, 180))])],
    },
    {
      result: variable(guide("formulaDaily"), ids.minimum),
      expression: [reference(), operator("×"), variable(guide("formulaPercent"), ids.bands)],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({ term: guide(`${key}Term`), body: guide(key, limitValues), id });
  const notes: GuideTerm[] = [
    note("methodReference", ids.reference),
    note("methodBands", ids.bands),
    note("methodWaiting", ids.waiting),
    note("methodMinimum", ids.minimum),
    note("methodIncrease", ids.increase),
    note("methodFloor", ids.floor),
    note("methodNetCap", ids.netCap),
    note("methodGap", ids.gap),
    note("methodBudget", ids.budget),
  ];

  return { values, limitValues, figures, flowOperators, formulas, notes };
}

export const DISMISSAL_GUIDE_IDS = {
  base: "dismissal-note-base",
  rates: "dismissal-note-rates",
  transitional: "dismissal-note-transitional",
  fixedTerm: "dismissal-note-fixed-term",
  durationLimit: "dismissal-note-duration-limit",
  caps: "dismissal-note-caps",
  fraction: "dismissal-note-fraction",
  tax: "dismissal-note-tax",
  budget: "dismissal-note-budget",
} as const;

export function buildDismissalGuide(locale: Lang): BenefitGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string, params?: Record<string, string>) => t(`tools.dismissalCompensation.${key}`, params);
  const guide = (key: string, params?: Record<string, string>) => t(`tools.dismissalCompensation.guide.${key}`, params);
  const ids = DISMISSAL_GUIDE_IDS;
  const example = computeDismissalCompensation(DISMISSAL_EXAMPLE);
  if (!example.ok) throw new Error("Invalid dismissal compensation worked example");

  const money = centsToMoney(locale);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const years = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const { result } = example;
  const line = (key: string) => result.lines.find((entry) => entry.key === key);
  const values = {
    base: formatMoney(locale, DISMISSAL_EXAMPLE.baseMonthly, { decimals: 0 }),
    seniorityPay: formatMoney(locale, DISMISSAL_EXAMPLE.seniorityPay, { decimals: 0 }),
    start: date(DISMISSAL_EXAMPLE.startDate),
    end: date(DISMISSAL_EXAMPLE.endDate),
    seniority: years(result.seniorityYears),
    daily: money(result.dailyCents),
    twentyYears: years(line("twentyDays")?.years ?? 0),
    twentyAmount: money(line("twentyDays")?.amountCents ?? 0),
    eighteenYears: years(line("eighteenDays")?.years ?? 0),
    eighteenAmount: money(line("eighteenDays")?.amountCents ?? 0),
    twelveYears: years(line("twelveDays")?.years ?? 0),
    twelveAmount: money(line("twelveDays")?.amountCents ?? 0),
    fourteenYears: years(line("fourteenDays")?.years ?? 0),
    fourteenAmount: money(line("fourteenDays")?.amountCents ?? 0),
    total: money(result.compensationCents),
    cap: money(result.capCents),
    rmmg: money(DISMISSAL_RMMG_CENTS),
    baseCap: money(20 * DISMISSAL_RMMG_CENTS),
    totalCapRmmg: money(240 * DISMISSAL_RMMG_CENTS),
  };

  // Each period's share of the compensation, as the calculator's breakdown lists them.
  const total = result.compensationCents;
  const figures: GuideFigure[] = [
    ...result.lines.map((entry) => {
      const share = total > 0 ? Math.round((entry.amountCents / total) * 1000) / 10 : null;
      return {
        label: tool(`result.periods.${entry.key}`, { years: years(entry.years), days: String(entry.daysPerYear) }),
        value: money(entry.amountCents),
        icon: CalendarDays,
        share,
        shareLabel: share === null ? undefined : formatPercent(locale, share),
      };
    }),
    { label: tool("result.compensation"), value: values.total, icon: Landmark, tone: "positive" as const },
  ];

  const daily = () => variable(guide("formulaDaily"), ids.base);
  const formulas: GuideFormulaLine[] = [
    {
      result: daily(),
      expression: [
        fraction(
          [variable(guide("formulaBase"), ids.base), operator("+"), variable(guide("formulaSeniorityPay"), ids.base)],
          [number(formatNumber(locale, 30))],
        ),
      ],
    },
    {
      result: variable(guide("formulaCompensation"), ids.caps),
      expression: [
        daily(),
        operator("×"),
        variable(guide("formulaDays"), ids.rates),
        operator("×"),
        variable(guide("formulaYears"), ids.fraction),
      ],
    },
  ];

  const note = (key: string, id: string): GuideTerm => ({ term: guide(`${key}Term`), body: guide(key, values), id });
  const notes: GuideTerm[] = [
    note("methodBase", ids.base),
    note("methodRates", ids.rates),
    note("methodTransitional", ids.transitional),
    note("methodFixedTerm", ids.fixedTerm),
    note("methodDurationLimit", ids.durationLimit),
    note("methodCaps", ids.caps),
    note("methodFraction", ids.fraction),
    note("methodTax", ids.tax),
    note("methodBudget", ids.budget),
  ];

  return { values, limitValues: values, figures, formulas, notes };
}
