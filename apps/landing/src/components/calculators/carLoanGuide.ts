/**
 * The car loan guide's content for one locale (CarLoanGuide.astro): the worked example's
 * values and figures, the method's formulas and the notes they link to. Every figure comes
 * from `computeCarLoan` on the example the calculator starts from.
 */
import { Banknote, CalendarClock, Car, Fuel, Landmark, Wallet } from "lucide-react";
import { CAR_LOAN_EXAMPLE, computeCarLoan } from "@/lib/calculators/carLoan";
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
export const CAR_LOAN_GUIDE_IDS = {
  loan: "car-loan-note-loan",
  budget: "car-loan-note-budget",
  apr: "car-loan-note-apr",
  assumptionLoan: "car-loan-note-fixed-rate",
  assumptionFees: "car-loan-note-fees",
  assumptionRunning: "car-loan-note-running",
} as const;

export function buildCarLoanGuide(locale: Lang) {
  const t = getTranslations(locale);
  const field = (key: string) => t(`tools.carLoan.fields.${key}`);
  const result = (key: string) => t(`tools.carLoan.result.${key}`);
  const guide = (key: string) => t(`tools.carLoan.guide.${key}`);
  const ids = CAR_LOAN_GUIDE_IDS;

  const example = computeCarLoan(CAR_LOAN_EXAMPLE);
  if (!example.ok) throw new Error("Invalid car loan worked example");

  const {
    price,
    deposit,
    termMonths,
    annualRate,
    upfrontFees,
    monthlyFees,
    monthlyFuel,
    annualInsurance,
    annualTax,
    annualMaintenance,
  } = CAR_LOAN_EXAMPLE;
  const { financedAmount, monthlyPayment, monthlyRunning, monthlyBudget } = example.result;
  const money = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const values = {
    price: money(price),
    deposit: money(deposit),
    financedAmount: money(financedAmount),
    months: formatNumber(locale, termMonths),
    rate: formatPercent(locale, annualRate, { decimals: 0 }),
    upfrontFees: money(upfrontFees),
    monthlyFees: money(monthlyFees),
    monthlyFuel: money(monthlyFuel),
    annualInsurance: money(annualInsurance),
    annualTax: money(annualTax),
    annualMaintenance: money(annualMaintenance),
    payment: money(monthlyPayment, 2),
    running: money(monthlyRunning, 2),
    budget: money(monthlyBudget, 2),
  };

  // The price less the deposit is what you finance.
  const financing: GuideFigure[] = [
    { label: field("price"), value: money(price, 2), icon: Car },
    { label: field("deposit"), value: money(deposit, 2), icon: Banknote },
    { label: result("financedAmount"), value: money(financedAmount, 2), icon: Landmark },
  ];

  // The loan payment plus the running costs is the car's monthly budget.
  const budget: GuideFigure[] = [
    { label: result("monthlyPayment"), value: values.payment, icon: CalendarClock },
    { label: result("monthlyRunning"), value: values.running, icon: Fuel },
    { label: result("monthlyBudget"), value: values.budget, icon: Wallet },
  ];

  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.loan);
  const one = () => number(formatNumber(locale, 1));
  const twelve = () => number(formatNumber(locale, 12));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(result("financedAmount"), ids.loan),
      expression: [variable(field("price"), ids.assumptionLoan), operator("−"), variable(field("deposit"), ids.assumptionLoan)],
    },
    {
      result: monthlyRate(),
      expression: [fraction([variable(field("annualRate"), ids.assumptionLoan)], [twelve()])],
    },
    {
      result: variable(result("monthlyPayment"), ids.loan),
      expression: [
        fraction(
          [variable(result("financedAmount"), ids.loan), operator("×"), monthlyRate()],
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(field("termMonths"), ids.loan)]),
          ],
        ),
        operator("+"),
        variable(field("monthlyFees"), ids.assumptionFees),
      ],
    },
    {
      result: variable(result("monthlyRunning"), ids.budget),
      expression: [
        variable(field("monthlyFuel"), ids.assumptionRunning),
        operator("+"),
        fraction(
          [
            variable(field("annualInsurance"), ids.budget),
            operator("+"),
            variable(field("annualTax"), ids.budget),
            operator("+"),
            variable(field("annualMaintenance"), ids.budget),
          ],
          [twelve()],
        ),
      ],
    },
    {
      result: variable(result("monthlyBudget"), ids.assumptionRunning),
      expression: [
        variable(result("monthlyPayment"), ids.loan),
        operator("+"),
        variable(result("monthlyRunning"), ids.budget),
      ],
    },
  ];

  const note = (key: keyof typeof ids, textKey: string): GuideTerm => ({
    term: guide(`terms.${key}`),
    body: guide(textKey),
    id: ids[key],
  });
  const notes: GuideTerm[] = [
    note("loan", "methodLoan"),
    note("budget", "methodBudget"),
    note("apr", "methodApr"),
  ];
  const assumptions: GuideTerm[] = [
    note("assumptionLoan", "assumptionLoan"),
    note("assumptionFees", "assumptionFees"),
    note("assumptionRunning", "assumptionRunning"),
  ];

  return { values, financing, budget, formulas, notes, assumptions };
}
