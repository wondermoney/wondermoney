/**
 * The early repayment guide's content for one locale (EarlyRepaymentGuide.astro): the two
 * choices and the checks before repaying as term lists, the worked example's values and
 * figures, and the method's formulas with the notes they link to. Every figure comes from
 * `computeEarlyRepayment` on the example the calculator starts from.
 */
import { CalendarClock, Landmark, Scissors, Wallet } from "lucide-react";
import {
  EARLY_REPAYMENT_EXAMPLE,
  EARLY_REPAYMENT_LIMITS,
  computeEarlyRepayment,
  type EarlyRepaymentResult,
} from "@/lib/calculators/earlyRepayment";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  group,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const EARLY_REPAYMENT_GUIDE_IDS = {
  lowerPayment: "early-repayment-note-lower-payment",
  shorterTerm: "early-repayment-note-shorter-term",
  fee: "early-repayment-note-fee",
  fixedRate: "early-repayment-note-fixed-rate",
  timing: "early-repayment-note-timing",
  oneOff: "early-repayment-note-one-off",
  costs: "early-repayment-note-costs",
  rounding: "early-repayment-note-rounding",
  lender: "early-repayment-note-lender",
  limits: "early-repayment-note-limits",
} as const;

function calculate(feePercent: number): EarlyRepaymentResult {
  const calculation = computeEarlyRepayment({ ...EARLY_REPAYMENT_EXAMPLE, feePercent });
  if (!calculation.ok) throw new Error("The early repayment worked example has invalid inputs");
  return calculation.result;
}

export function buildEarlyRepaymentGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string, values?: Record<string, string>) => t(`tools.earlyRepayment.${key}`, values);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.earlyRepayment.guide.${key}`, values);
  const ids = EARLY_REPAYMENT_GUIDE_IDS;

  const example = calculate(EARLY_REPAYMENT_EXAMPLE.feePercent);
  const withFee = calculate(EARLY_REPAYMENT_EXAMPLE.exampleFeePercent);

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const duration = (months: number) => formatDuration(locale, months);
  const values = {
    balance: money(EARLY_REPAYMENT_EXAMPLE.balance, 0),
    term: duration(example.original.months),
    rate: formatPercent(locale, EARLY_REPAYMENT_EXAMPLE.annualRate, { decimals: 1 }),
    payment: money(example.original.monthlyPayment),
    interest: money(example.original.totalInterest),
    repayment: money(EARLY_REPAYMENT_EXAMPLE.repayment, 0),
    balanceAfter: money(example.balanceAfter, 0),
    newPayment: money(example.lowerPayment.monthlyPayment),
    paymentDrop: money(example.lowerPayment.paymentReduction),
    lowerSaved: money(example.lowerPayment.interestSaved),
    newTerm: duration(example.shorterTerm.months),
    timeSaved: duration(example.shorterTerm.monthsSaved),
    lastPayment: money(example.shorterTerm.lastPayment),
    shorterSaved: money(example.shorterTerm.interestSaved),
    feeRate: formatPercent(locale, EARLY_REPAYMENT_EXAMPLE.exampleFeePercent, { decimals: 1 }),
    fee: money(withFee.fee),
    lowerNet: money(withFee.lowerPayment.netSaving),
    shorterNet: money(withFee.shorterTerm.netSaving),
    minBalance: money(EARLY_REPAYMENT_LIMITS.minBalance, 0),
    maxBalance: money(EARLY_REPAYMENT_LIMITS.maxBalance, 0),
    maxYears: formatNumber(locale, EARLY_REPAYMENT_LIMITS.maxTermYears),
    maxRate: formatPercent(locale, EARLY_REPAYMENT_LIMITS.maxAnnualRate, { decimals: 0 }),
    maxFee: formatPercent(locale, EARLY_REPAYMENT_LIMITS.maxFeePercent, { decimals: 0 }),
  };

  const choices: GuideTerm[] = ["lowerPayment", "shorterTerm"].map((key) => ({
    term: guide(`choice.${key}Title`),
    body: guide(`choice.${key}`),
  }));
  const checks: GuideTerm[] = Object.values(
    t<Record<string, { term: string; body: string }>>("tools.earlyRepayment.guide.before.items", { returnObjects: true }),
  ).map(({ term, body }) => ({ term, body }));

  // The repayment comes off the balance the rest of the loan is worked out on.
  const repayment: GuideFigure[] = [
    { label: tool("balance"), value: money(EARLY_REPAYMENT_EXAMPLE.balance), icon: Landmark },
    { label: tool("repayment"), value: money(EARLY_REPAYMENT_EXAMPLE.repayment), icon: Wallet },
    { label: tool("summary.balanceAfter"), value: money(example.balanceAfter), icon: Landmark },
  ];

  // What each choice gives, from the table's columns.
  const outcomes: GuideFigure[] = [
    {
      label: tool("lowerPayment.headline"),
      value: values.newPayment,
      icon: CalendarClock,
      detail: `−${values.paymentDrop}`,
    },
    { label: tool("shorterTerm.headline"), value: values.timeSaved, icon: Scissors },
  ];
  const saved = (lower: string, shorter: string): GuideFigure[] => [
    { label: tool("table.lowerPayment"), value: lower },
    { label: tool("table.shorterTerm"), value: shorter, tone: "positive" },
  ];
  const interestSaved = saved(values.lowerSaved, values.shorterSaved);
  const netSaving = saved(values.lowerNet, values.shorterNet);

  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.fixedRate);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: monthlyRate(),
      expression: [fraction([variable(tool("interestRate"), ids.fixedRate)], [number(formatNumber(locale, 12))])],
    },
    {
      result: variable(tool("summary.balanceAfter"), ids.timing),
      expression: [variable(tool("balance"), ids.limits), operator("−"), variable(tool("repayment"), ids.oneOff)],
    },
    {
      result: variable(tool("lowerPayment.headline"), ids.lowerPayment),
      expression: [
        fraction(
          [variable(tool("summary.balanceAfter"), ids.timing), operator("×"), monthlyRate()],
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(t("tools.mortgage.guide.labels.payments"), ids.lowerPayment)]),
          ],
        ),
      ],
    },
    {
      result: variable(tool("summary.fee"), ids.fee),
      expression: [variable(tool("repayment"), ids.oneOff), operator("×"), variable(tool("fee"), ids.fee)],
    },
    {
      result: variable(tool("table.netSaving"), ids.fee),
      expression: [variable(tool("table.interestSaved"), ids.fee), operator("−"), variable(tool("summary.fee"), ids.fee)],
    },
  ];

  const method = (key: string) => `method.${key}`;
  const notes: GuideTerm[] = [
    { term: guide(method("lowerPaymentTerm")), body: guide(method("lowerPaymentBody")), id: ids.lowerPayment },
    { term: guide(method("shorterTermTerm")), body: guide(method("shorterTermBody")), id: ids.shorterTerm },
    { term: guide(method("terms.feeNote")), body: guide(method("fee")), id: ids.fee },
  ];
  const assumption = (key: string, id: string, body = guide(method(`assumptions.${key}`))): GuideTerm => ({
    term: guide(method(`terms.${key}`)),
    body,
    id,
  });
  const assumptions: GuideTerm[] = [
    assumption("fixedRate", ids.fixedRate),
    assumption("timing", ids.timing),
    assumption("oneOff", ids.oneOff),
    assumption("costs", ids.costs),
    assumption("rounding", ids.rounding),
    assumption("lenderFigures", ids.lender),
    assumption("limits", ids.limits, guide(method("limits"), values)),
  ];

  return { values, choices, checks, repayment, outcomes, interestSaved, netSaving, formulas, notes, assumptions };
}
