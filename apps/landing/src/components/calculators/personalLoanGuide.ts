/**
 * The personal loan guide's content for one locale (PersonalLoanGuide.astro): the worked
 * example's values and figures, and the method's formulas with the notes they link to. Every
 * figure comes from `computePersonalLoan` on the example the calculator starts from, without
 * and with the example's fees.
 */
import { BadgePercent, CalendarClock, HandCoins, Landmark, Percent, Wallet } from "lucide-react";
import {
  PERSONAL_LOAN_EXAMPLE,
  PERSONAL_LOAN_LIMITS,
  computePersonalLoan,
  type PersonalLoanInput,
} from "@/lib/calculators/personalLoan";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  group,
  number,
  operator,
  sum,
  variable,
  type GuideFigure,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const PERSONAL_LOAN_GUIDE_IDS = {
  apr: "personal-loan-note-apr",
  rounding: "personal-loan-note-rounding",
  privacy: "personal-loan-note-privacy",
  fixedRate: "personal-loan-note-fixed-rate",
  fees: "personal-loan-note-fees",
  otherCosts: "personal-loan-note-other-costs",
  limits: "personal-loan-note-limits",
} as const;

function calculate(overrides: Partial<PersonalLoanInput> = {}) {
  const calculation = computePersonalLoan({ ...PERSONAL_LOAN_EXAMPLE, ...overrides });
  if (!calculation.ok) throw new Error("The personal loan worked example has invalid inputs");
  return calculation.result;
}

export function buildPersonalLoanGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.personalLoan.${key}`);
  const guide = (key: string, values?: Record<string, string>) => t(`tools.personalLoan.guide.${key}`, values);
  const ids = PERSONAL_LOAN_GUIDE_IDS;

  const example = calculate();
  const withFees = calculate({
    upfrontFees: PERSONAL_LOAN_EXAMPLE.exampleUpfrontFees,
    monthlyFees: PERSONAL_LOAN_EXAMPLE.exampleMonthlyFees,
  });

  const exact = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const euros = (value: number) => formatMoney(locale, value, { decimals: 0 });
  const pct = (value: number, decimals = 2) => formatPercent(locale, value, { decimals });

  const values = {
    amount: euros(PERSONAL_LOAN_EXAMPLE.amount),
    months: formatNumber(locale, PERSONAL_LOAN_EXAMPLE.termMonths),
    rate: pct(PERSONAL_LOAN_EXAMPLE.annualRate, Number.isInteger(PERSONAL_LOAN_EXAMPLE.annualRate) ? 0 : 1),
    payment: exact(example.monthlyPayment),
    interest: exact(example.totalInterest),
    totalRepaid: exact(example.totalRepaid),
    apr: pct(example.apr),
    upfront: euros(PERSONAL_LOAN_EXAMPLE.exampleUpfrontFees),
    monthlyFee: euros(PERSONAL_LOAN_EXAMPLE.exampleMonthlyFees),
    received: exact(withFees.amountReceived),
    paymentWithFees: exact(withFees.monthlyPayment),
    fees: exact(withFees.totalFees),
    cost: exact(withFees.totalCostOfCredit),
    totalRepaidFees: exact(withFees.totalRepaid),
    aprFees: pct(withFees.apr),
    minAmount: euros(PERSONAL_LOAN_LIMITS.minAmount),
    maxAmount: euros(PERSONAL_LOAN_LIMITS.maxAmount),
    minMonths: formatNumber(locale, PERSONAL_LOAN_LIMITS.minTermMonths),
    maxMonths: formatNumber(locale, PERSONAL_LOAN_LIMITS.maxTermMonths),
    maxRate: pct(PERSONAL_LOAN_LIMITS.maxAnnualRate, 0),
  };

  // Without fees: what you borrow plus the interest is what you pay back.
  const noFees: GuideFigure[] = [
    { label: tool("amount"), value: exact(PERSONAL_LOAN_EXAMPLE.amount), icon: Landmark },
    { label: tool("result.totalInterest"), value: values.interest, icon: Percent },
    { label: tool("result.totalRepaid"), value: values.totalRepaid, icon: Wallet },
  ];

  // With the example's fees: what you receive, pay each month and pay for the credit.
  const fees: GuideFigure[] = [
    { label: guide("labels.amountReceived"), value: values.received, icon: HandCoins },
    { label: tool("result.monthlyPayment"), value: values.paymentWithFees, icon: CalendarClock },
    { label: tool("result.totalCostOfCredit"), value: values.cost, icon: BadgePercent },
  ];

  // The same nominal rate, and the APR without and with the fees.
  const rates: GuideFigure[] = [
    { label: tool("annualRate"), value: values.rate },
    { label: guide("labels.aprNoFees"), value: values.apr },
    { label: guide("labels.aprFees"), value: values.aprFees, tone: "negative" },
  ];

  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.fixedRate);
  const term = () => variable(tool("termMonths"), ids.limits);
  const received = () => variable(guide("labels.amountReceived"), ids.fees);
  const apr = () => variable(guide("labels.apr"), ids.apr);
  const one = () => number(formatNumber(locale, 1));
  const formulas: GuideFormulaLine[] = [
    {
      result: monthlyRate(),
      expression: [fraction([variable(tool("annualRate"), ids.fixedRate)], [number(formatNumber(locale, 12))])],
    },
    {
      result: variable(tool("result.monthlyPayment"), ids.rounding),
      expression: [
        fraction(
          [variable(tool("amount"), ids.limits), operator("×"), monthlyRate()],
          [one(), operator("−"), group([one(), operator("+"), monthlyRate()], [operator("−"), term()])],
        ),
      ],
    },
    {
      result: received(),
      expression: [variable(tool("amount"), ids.limits), operator("−"), variable(tool("upfrontFees"), ids.fees)],
    },
    {
      result: received(),
      expression: [
        sum(
          [variable(guide("labels.month"), ids.apr), operator("="), one()],
          [term()],
          [
            fraction(
              [
                variable(tool("result.monthlyPayment"), ids.rounding),
                operator("+"),
                variable(tool("monthlyFees"), ids.fees),
              ],
              [
                group([one(), operator("+"), apr()], [variable(guide("labels.month"), ids.apr), operator("÷"), number(formatNumber(locale, 12))]),
              ],
            ),
          ],
        ),
      ],
    },
  ];

  const notes: GuideTerm[] = [
    { term: guide("methodAprTerm"), body: guide("methodApr"), id: ids.apr },
    { term: guide("methodRoundingTerm"), body: guide("methodRounding"), id: ids.rounding },
    { term: guide("methodPrivacyTerm"), body: guide("methodPrivacy"), id: ids.privacy },
  ];
  const assumption = (key: "FixedRate" | "Fees" | "OtherCosts" | "Limits", id: string): GuideTerm => ({
    term: guide(`assumption${key}Term`),
    body: guide(`assumption${key}`, values),
    id,
  });
  const assumptions: GuideTerm[] = [
    assumption("FixedRate", ids.fixedRate),
    assumption("Fees", ids.fees),
    assumption("OtherCosts", ids.otherCosts),
    assumption("Limits", ids.limits),
  ];

  return { values, noFees, fees, rates, formulas, notes, assumptions };
}
