/**
 * The mortgage guide's content for one locale (MortgageCalculatorGuide.astro): the worked
 * example's values and figures, the method's formulas and the notes they link to. Every figure
 * comes from `computeMortgage` on the example the calculator starts from.
 */
import { CalendarClock, Landmark, Percent, PiggyBank, Wallet } from "lucide-react";
import {
  MORTGAGE_EXAMPLE,
  MORTGAGE_LIMITS,
  computeMortgage,
  type MortgageResult,
} from "@/lib/calculators/mortgage";
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
export const MORTGAGE_GUIDE_IDS = {
  fixedRate: "mortgage-note-fixed-rate",
  monthly: "mortgage-note-monthly",
  nominalRate: "mortgage-note-nominal-rate",
  fees: "mortgage-note-fees",
  rounding: "mortgage-note-rounding",
  lender: "mortgage-note-lender",
  limits: "mortgage-note-limits",
} as const;

function calculate(monthlyFees: number): MortgageResult {
  const calculation = computeMortgage({ ...MORTGAGE_EXAMPLE, monthlyFees });
  if (!calculation.ok) throw new Error("The mortgage worked example has invalid inputs");
  return calculation.result;
}

export function buildMortgageGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.mortgage.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.mortgage.guide.${key}`, values);
  const ids = MORTGAGE_GUIDE_IDS;

  const example = calculate(0);
  const withFees = calculate(MORTGAGE_EXAMPLE.exampleMonthlyFees);
  const halfway = Math.floor(MORTGAGE_EXAMPLE.termYears / 2);
  const [firstMonth] = example.years[0].months;

  const money = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const share = (part: number) => Math.round((part / firstMonth.payment) * 1000) / 10;
  const values = {
    amount: money(MORTGAGE_EXAMPLE.loanAmount),
    years: formatNumber(locale, MORTGAGE_EXAMPLE.termYears),
    rate: formatPercent(locale, MORTGAGE_EXAMPLE.annualRate, { decimals: 1 }),
    monthlyRate: formatPercent(locale, MORTGAGE_EXAMPLE.annualRate / 12, { decimals: 4 }),
    payments: formatNumber(locale, example.numberOfPayments),
    payment: money(example.monthlyPayment, 2),
    firstInterest: money(firstMonth.interest, 2),
    firstPrincipal: money(firstMonth.principal, 2),
    totalInterest: money(example.totalInterest, 2),
    totalPaid: money(example.totalPaid, 2),
    halfway: formatNumber(locale, halfway),
    halfwayBalance: money(example.years[halfway - 1].balance, 2),
    fees: money(MORTGAGE_EXAMPLE.exampleMonthlyFees),
    monthlyWithFees: money(withFees.monthlyTotal, 2),
    totalPaidWithFees: money(withFees.totalPaid, 2),
    minAmount: money(MORTGAGE_LIMITS.minLoanAmount),
    maxAmount: money(MORTGAGE_LIMITS.maxLoanAmount),
    maxYears: formatNumber(locale, MORTGAGE_LIMITS.maxTermYears),
    maxRate: formatPercent(locale, MORTGAGE_LIMITS.maxAnnualRate, { decimals: 0 }),
  };

  // The loan over its whole term: what you borrow plus the interest is what you pay.
  const totals: GuideFigure[] = [
    { label: tool("loanAmount"), value: money(MORTGAGE_EXAMPLE.loanAmount, 2), icon: Landmark },
    { label: tool("totalInterest"), value: values.totalInterest, icon: Percent },
    { label: tool("totalPaid"), value: values.totalPaid, icon: Wallet },
  ];

  // The first payment, split into the interest it pays and the principal it repays.
  const firstPayment: GuideFigure[] = [
    { label: tool("monthlyPayment"), value: values.payment, icon: CalendarClock },
    {
      label: guide("labels.firstInterest"),
      value: values.firstInterest,
      icon: Percent,
      share: share(firstMonth.interest),
      shareLabel: formatPercent(locale, share(firstMonth.interest)),
    },
    {
      label: guide("labels.firstPrincipal"),
      value: values.firstPrincipal,
      icon: PiggyBank,
      share: share(firstMonth.principal),
      shareLabel: formatPercent(locale, share(firstMonth.principal)),
      tone: "positive",
    },
  ];

  const monthlyRate = () => variable(guide("labels.monthlyRate"), ids.nominalRate);
  const payments = () => variable(guide("labels.payments"), ids.monthly);
  const one = number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: monthlyRate(),
      expression: [fraction([variable(tool("interestRate"), ids.nominalRate)], [number(formatNumber(locale, 12))])],
    },
    {
      result: payments(),
      expression: [variable(tool("loanTerm"), ids.monthly), operator("×"), number(formatNumber(locale, 12))],
    },
    {
      result: variable(tool("monthlyPayment"), ids.rounding),
      expression: [
        fraction(
          [variable(tool("loanAmount"), ids.limits), operator("×"), monthlyRate()],
          [one, operator("−"), group([one, operator("+"), monthlyRate()], [operator("−"), payments()])],
        ),
      ],
    },
    {
      result: variable(tool("monthlyTotal"), ids.fees),
      expression: [
        variable(tool("monthlyPayment"), ids.rounding),
        operator("+"),
        variable(tool("monthlyFees"), ids.fees),
      ],
    },
  ];

  const note = (key: string, id: string, body?: string): GuideTerm => ({
    term: guide(`method.terms.${key}`),
    body: body ?? guide(`method.assumptions.${key}`),
    id,
  });
  const notes: GuideTerm[] = [
    note("fixedRate", ids.fixedRate),
    note("monthly", ids.monthly),
    note("nominalRate", ids.nominalRate),
    note("flatFees", ids.fees),
    note("rounding", ids.rounding),
    note("lenderFigures", ids.lender),
    note("limits", ids.limits, guide("method.limits", values)),
  ];

  return { values, totals, firstPayment, formulas, notes };
}
