/**
 * The rate revision guide's content for one locale (RateRevisionGuide.astro): the worked
 * example's values and figures, the method's formulas with the notes they link to, and what
 * the contract decides as a term list. Every figure comes from `computeRateRevision` on the
 * example the calculator starts from.
 */
import { CalendarClock, Plus, TrendingUp } from "lucide-react";
import {
  DEBT_TO_INCOME_CAUTION_FROM,
  DEBT_TO_INCOME_HIGH_ABOVE,
  type DebtToIncomeBand,
} from "@/lib/calculators/debtToIncome";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
import {
  RATE_REVISION_EXAMPLE,
  RATE_REVISION_LIMITS,
  computeRateRevision,
  shiftedIndex,
  type RateRevisionInput,
} from "@/lib/calculators/rateRevision";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  call,
  fraction,
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFigureTone,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const RATE_REVISION_GUIDE_IDS = {
  change: "rate-revision-note-change",
  year: "rate-revision-note-year",
  interest: "rate-revision-note-interest",
  income: "rate-revision-note-income",
  privacy: "rate-revision-note-privacy",
  fromNextMonth: "rate-revision-note-from-next-month",
  sameTerm: "rate-revision-note-same-term",
  statement: "rate-revision-note-statement",
  noFeed: "rate-revision-note-no-feed",
  limits: "rate-revision-note-limits",
} as const;

const BAND_TONE: Record<DebtToIncomeBand, GuideFigureTone> = {
  healthy: "positive",
  caution: "default",
  high: "negative",
};

const exampleInput: RateRevisionInput = {
  balance: RATE_REVISION_EXAMPLE.balance,
  termYears: RATE_REVISION_EXAMPLE.termYears,
  termMonths: RATE_REVISION_EXAMPLE.termMonths,
  indexRate: RATE_REVISION_EXAMPLE.indexRate,
  spread: RATE_REVISION_EXAMPLE.spread,
  newIndexRate: RATE_REVISION_EXAMPLE.newIndexRate,
  monthlyIncome: RATE_REVISION_EXAMPLE.monthlyIncome,
};

function calculate(overrides: Partial<RateRevisionInput> = {}) {
  const calculation = computeRateRevision({ ...exampleInput, ...overrides });
  if (!calculation.ok) throw new Error("The rate revision worked example has invalid inputs");
  return calculation.result;
}

export function buildRateRevisionGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.rateRevision.${key}`, values);
  const guide = (key: string, values?: Record<string, string | number>) => t(`tools.rateRevision.guide.${key}`, values);
  const ids = RATE_REVISION_GUIDE_IDS;

  const example = calculate();
  const stress = calculate({
    newIndexRate: shiftedIndex(RATE_REVISION_EXAMPLE.indexRate, RATE_REVISION_EXAMPLE.exampleStressStep),
  });
  const shares = [example.income?.current, example.income?.revised, stress.income?.revised];
  if (example.monthlyChange <= 0 || !shares.every((share) => share?.status === "ok")) {
    throw new Error("The worked example should raise the payment and show a share of income");
  }
  const [currentShare, newShare, stressShare] = shares as Array<
    Extract<NonNullable<(typeof shares)[number]>, { status: "ok" }>
  >;
  const bandName = (band: DebtToIncomeBand) => t(`tools.debtToIncome.band${band[0].toUpperCase()}${band.slice(1)}`);

  const exact = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const euros = (value: number) => formatMoney(locale, value, { decimals: 0 });
  const pct = (value: number, decimals = Number.isInteger(value) ? 0 : 1) => formatPercent(locale, value, { decimals });

  const values = {
    balance: euros(RATE_REVISION_EXAMPLE.balance),
    term: formatDuration(locale, example.months),
    index: pct(RATE_REVISION_EXAMPLE.indexRate),
    spread: pct(RATE_REVISION_EXAMPLE.spread),
    rate: pct(example.current.rate),
    payment: exact(example.current.monthlyPayment),
    interest: exact(example.current.totalInterest),
    newIndex: pct(example.revised.indexRate),
    newRate: pct(example.revised.rate),
    newPayment: exact(example.revised.monthlyPayment),
    monthlyChange: exact(example.monthlyChange),
    percent: pct(example.monthlyChangePercent, 1),
    yearlyChange: exact(example.nextYear.change),
    interestChange: exact(example.totalInterestChange),
    stressStep: formatNumber(locale, RATE_REVISION_EXAMPLE.exampleStressStep),
    stressRate: pct(stress.revised.rate),
    stressPayment: exact(stress.revised.monthlyPayment),
    stressChange: exact(stress.monthlyChange),
    income: euros(RATE_REVISION_EXAMPLE.monthlyIncome),
    currentShare: pct(currentShare.ratio, 1),
    newShare: pct(newShare.ratio, 1),
    stressShare: pct(stressShare.ratio, 1),
    stressBand: bandName(stressShare.band),
    caution: DEBT_TO_INCOME_CAUTION_FROM,
    high: DEBT_TO_INCOME_HIGH_ABOVE,
    minBalance: euros(RATE_REVISION_LIMITS.minBalance),
    maxBalance: euros(RATE_REVISION_LIMITS.maxBalance),
    maxYears: formatNumber(locale, RATE_REVISION_LIMITS.maxTermYears),
    minIndex: pct(RATE_REVISION_LIMITS.minIndexRate),
    maxIndex: pct(RATE_REVISION_LIMITS.maxIndexRate),
    maxSpread: pct(RATE_REVISION_LIMITS.maxSpread),
  };

  // Today's payment plus the change is the payment after the revision.
  const rise: GuideFigure[] = [
    { label: tool("result.currentPayment", { rate: values.rate }), value: values.payment, icon: CalendarClock },
    { label: tool("result.monthlyChange"), value: `+${values.monthlyChange}`, icon: Plus },
    {
      label: tool("result.revisedPayment", { rate: values.newRate }),
      value: values.newPayment,
      icon: TrendingUp,
    },
  ];

  // The payment as a share of income: today, after the rise and after the larger one.
  const incomeShares: GuideFigure[] = [
    { label: tool("table.today"), payment: values.payment, share: currentShare },
    { label: tool("result.revisedPayment", { rate: values.newRate }), payment: values.newPayment, share: newShare },
    { label: tool("result.revisedPayment", { rate: values.stressRate }), payment: values.stressPayment, share: stressShare },
  ].map(({ label, payment, share }) => ({
    label,
    value: pct(share.ratio, 1),
    detail: payment,
    share: share.ratio,
    shareLabel: bandName(share.band),
    tone: BAND_TONE[share.band],
  }));

  const annualRate = () => variable(guide("terms.annualRate"), ids.statement);
  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.fromNextMonth);
  const payment = () => variable(tool("table.payment"), ids.sameTerm);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: annualRate(),
      expression: [
        call(
          "max",
          [number(formatNumber(locale, 0))],
          [variable(tool("table.index"), ids.noFeed), operator("+"), variable(tool("spread"), ids.statement)],
        ),
      ],
    },
    {
      result: monthlyRate(),
      expression: [fraction([annualRate()], [number(formatNumber(locale, 12))])],
    },
    {
      result: payment(),
      expression: [
        fraction(
          [variable(tool("balance"), ids.limits), operator("×"), monthlyRate()],
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(t("tools.mortgage.guide.labels.payments"), ids.sameTerm)]),
          ],
        ),
      ],
    },
    {
      result: variable(tool("result.monthlyChange"), ids.change),
      expression: [
        variable(tool("result.newPayment"), ids.change),
        operator("−"),
        variable(guide("terms.statement"), ids.statement),
      ],
    },
    {
      result: variable(guide("terms.incomeShare"), ids.income),
      expression: [
        fraction([payment()], [variable(tool("monthlyIncome"), ids.income)]),
        operator("×"),
        number(formatNumber(locale, 100)),
      ],
    },
  ];

  const methodItems = t<Record<string, string>>("tools.rateRevision.guide.methodItems", { returnObjects: true });
  const notes: GuideTerm[] = (["change", "year", "interest", "income", "privacy"] as const).map((key) => ({
    term: guide(`terms.${key}`),
    body: guide(`methodItems.${key}`, values),
    id: ids[key],
  }));
  if (Object.keys(methodItems).length !== notes.length) throw new Error("A rate revision method note has no term");

  const assumptions: GuideTerm[] = [
    ...(["fromNextMonth", "sameTerm", "statement", "noFeed"] as const).map((key) => ({
      term: guide(`terms.${key}`),
      body: guide(`assumptions.${key}`, values),
      id: ids[key],
    })),
    { term: guide("terms.limits"), body: guide("limits", values), id: ids.limits },
  ];

  const contract: GuideTerm[] = Object.values(
    t<Record<string, { term: string; body: string }>>("tools.rateRevision.guide.contractItems", { returnObjects: true }),
  ).map(({ term, body }) => ({ term, body }));

  return { values, rise, incomeShares, formulas, notes, assumptions, contract };
}
