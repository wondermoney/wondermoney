/**
 * The borrowing capacity guide's content for one locale (BorrowingCapacityGuide.astro): the
 * worked example's values, its steps and figures, the method's formulas, the notes they link
 * to and what lenders check. Every figure comes from `computeBorrowingCapacity` on the
 * example the calculator starts from.
 */
import { Banknote, House, Landmark, PiggyBank, Wallet } from "lucide-react";
import {
  BORROWING_CAPACITY_EXAMPLE,
  computeBorrowingCapacity,
  type BorrowingCapacityInput,
} from "@/lib/calculators/borrowingCapacity";
import { DEBT_TO_INCOME_CAUTION_FROM, DEBT_TO_INCOME_HIGH_ABOVE } from "@/lib/calculators/debtToIncome";
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
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const BORROWING_CAPACITY_GUIDE_IDS = {
  share: "borrowing-capacity-note-share",
  costs: "borrowing-capacity-note-costs",
  rounding: "borrowing-capacity-note-rounding",
  privacy: "borrowing-capacity-note-privacy",
  fixedRate: "borrowing-capacity-note-fixed-rate",
  savings: "borrowing-capacity-note-savings",
  payment: "borrowing-capacity-note-payment",
  costsShare: "borrowing-capacity-note-costs-share",
} as const;

function calculate(overrides: Partial<BorrowingCapacityInput> = {}) {
  const calculation = computeBorrowingCapacity({ ...BORROWING_CAPACITY_EXAMPLE, ...overrides });
  if (!calculation.ok || calculation.result.status !== "ok") {
    throw new Error("The borrowing capacity worked example has invalid inputs");
  }
  return calculation.result;
}

export function buildBorrowingCapacityGuide(locale: Lang) {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.borrowingCapacity.${key}`);
  const guide = (key: string, values?: Record<string, string | number>) =>
    t(`tools.borrowingCapacity.guide.${key}`, values);
  const ids = BORROWING_CAPACITY_GUIDE_IDS;

  const example = calculate();
  const lowSavings = BORROWING_CAPACITY_EXAMPLE.savings / 2;
  const savingsBound = calculate({ savings: lowSavings });
  if (example.binding !== "monthly" || example.lift?.kind !== "income" || !example.mortgage) {
    throw new Error("The worked example should be limited by the monthly budget");
  }
  if (savingsBound.binding !== "cash") {
    throw new Error("The second worked example should be limited by the savings");
  }

  const exact = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const euros = (value: number) => formatMoney(locale, value, { decimals: 0 });
  const pct = (value: number) => formatPercent(locale, value, { decimals: Number.isInteger(value) ? 0 : 1 });

  const values = {
    income: euros(BORROWING_CAPACITY_EXAMPLE.monthlyIncome),
    existing: euros(BORROWING_CAPACITY_EXAMPLE.existingPayments),
    share: pct(BORROWING_CAPACITY_EXAMPLE.maxDebtShare),
    allowed: exact(example.monthly.allowedPayments),
    room: exact(example.monthly.maxNewPayment),
    rate: pct(BORROWING_CAPACITY_EXAMPLE.annualRate),
    years: formatNumber(locale, BORROWING_CAPACITY_EXAMPLE.termYears),
    maxLoan: exact(example.monthly.maxLoan),
    savings: euros(BORROWING_CAPACITY_EXAMPLE.savings),
    costsRate: pct(BORROWING_CAPACITY_EXAMPLE.purchaseCostsRate),
    ltv: pct(BORROWING_CAPACITY_EXAMPLE.maxLoanToValue),
    deposit: pct(example.cash.depositShare),
    cashShare: pct(example.cash.cashShare),
    cashPrice: exact(example.cash.priceCeiling ?? 0),
    monthlyPrice: exact(example.monthly.priceCeiling),
    price: exact(example.price),
    loan: exact(example.loan),
    downPayment: exact(example.downPayment),
    purchaseCosts: exact(example.purchaseCosts),
    payment: exact(example.mortgage.monthlyPayment),
    extraIncome: euros(example.lift.extraMonthlyIncome),
    liftPrice: euros(example.lift.price),
    lowSavings: euros(lowSavings),
    lowSavingsPrice: exact(savingsBound.price),
    lowSavingsLoan: exact(savingsBound.loan),
    caution: DEBT_TO_INCOME_CAUTION_FROM,
    high: DEBT_TO_INCOME_HIGH_ABOVE,
  };

  const steps: GuideTerm[] = ["exampleStep1", "exampleStep2", "exampleStep3"].map((key) => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`, values),
  }));

  // The two limits side by side, and the lower one as the price within reach.
  const limits: GuideFigure[] = [
    { label: tool("limits.monthlyPrice"), value: values.monthlyPrice, icon: Wallet },
    { label: tool("limits.cashPrice"), value: values.cashPrice, icon: PiggyBank },
    { label: tool("result.price"), value: values.price, icon: House, tone: "positive" },
  ];

  // How the price is paid for: the loan and the down payment.
  const purchase: GuideFigure[] = [
    { label: tool("result.loan"), value: values.loan, icon: Landmark },
    { label: tool("result.downPayment"), value: values.downPayment, icon: Banknote },
    { label: tool("result.price"), value: values.price, icon: House },
  ];

  const room = () => variable(tool("limits.room"), ids.share);
  const monthlyRate = () => variable(t("tools.mortgage.guide.labels.monthlyRate"), ids.fixedRate);
  const maxLoan = () => variable(guide("labels.maxLoan"), ids.rounding);
  const savings = () => variable(tool("savings"), ids.savings);
  const costs = () => variable(tool("purchaseCostsRate"), ids.costsShare);
  const monthlyPrice = () => variable(tool("limits.monthlyPrice"), ids.costs);
  const cashPrice = () => variable(tool("limits.cashPrice"), ids.costs);
  const one = () => number(formatNumber(locale, 1));

  const formulas: GuideFormulaLine[] = [
    {
      result: room(),
      expression: [
        variable(tool("monthlyIncome"), ids.share),
        operator("×"),
        variable(tool("maxDebtShare"), ids.share),
        operator("−"),
        variable(tool("existingPayments"), ids.share),
      ],
    },
    {
      result: maxLoan(),
      expression: [
        room(),
        operator("×"),
        fraction(
          [
            one(),
            operator("−"),
            group([one(), operator("+"), monthlyRate()], [operator("−"), variable(t("tools.mortgage.guide.labels.payments"), ids.fixedRate)]),
          ],
          [monthlyRate()],
        ),
      ],
    },
    {
      result: monthlyPrice(),
      expression: [fraction([maxLoan(), operator("+"), savings()], [one(), operator("+"), costs()])],
    },
    {
      result: cashPrice(),
      expression: [
        fraction(
          [savings()],
          [one(), operator("−"), variable(tool("maxLoanToValue"), ids.costs), operator("+"), costs()],
        ),
      ],
    },
    {
      result: variable(tool("result.price"), ids.costs),
      expression: [call("min", [monthlyPrice()], [cashPrice()])],
    },
  ];

  const note = (key: string, id: string, bodyKey = key): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(bodyKey, values),
    id,
  });

  const notes: GuideTerm[] = [
    note("methodShare", ids.share),
    note("methodCosts", ids.costs),
    { term: guide("methodRoundingTerm"), body: guide("methodRounding"), id: ids.rounding },
    { term: guide("methodPrivacyTerm"), body: guide("methodPrivacy"), id: ids.privacy },
  ];
  const assumptions: GuideTerm[] = [
    note("assumptionFixedRate", ids.fixedRate),
    note("assumptionSavings", ids.savings),
    note("assumptionPayment", ids.payment),
    note("assumptionCostsShare", ids.costsShare),
  ];

  const lenderRules: GuideTerm[] = ["lenderStress", "lenderIncome", "lenderCountry", "lenderProfile"].map(
    (key) => ({ term: guide(`${key}Term`), body: guide(`${key}Body`) }),
  );

  return { values, steps, limits, purchase, formulas, notes, assumptions, lenderRules };
}
