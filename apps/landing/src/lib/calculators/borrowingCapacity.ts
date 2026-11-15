/**
 * Borrowing capacity: the highest home price a household can reach, from two separate limits.
 *
 * 1. Monthly: net income × the largest share of it that may go to credit, minus the credit
 *    payments already made, is the room for a new payment. The largest fixed-rate loan with
 *    that level payment, at the rate and over the term, is the most the income supports.
 * 2. Upfront cash: savings pay the part of the price the lender doesn't (100% − the maximum
 *    loan-to-value) plus the one-off purchase costs, both as a share of the price.
 *
 * The result is the highest price both allow, with every euro of savings going into it. The
 * loan's payment and schedule come from the mortgage calculator, so the two tools agree to the
 * cent, and the debt-to-income ratio with the new payment comes from the debt-to-income tool.
 *
 * This is an estimate on the visitor's own figures. Lenders apply their own rules (a stressed
 * rate, their own definition of income, limits set by each country's regulator), and none of
 * them is built in here.
 *
 * Amounts are worked in whole cents and percentages in hundredths of a percent, so the price
 * always equals loan + down payment, and down payment + costs never exceed the savings.
 */

import { computeDebtToIncome, type DebtToIncomeResult } from "./debtToIncome";
import { MORTGAGE_LIMITS, computeMortgage, type MortgageResult } from "./mortgage";

export const BORROWING_CAPACITY_LIMITS = {
  /** Euros a month, for income and existing payments. */
  maxMonthlyAmount: 1_000_000,
  /** Euros. */
  maxSavings: 100_000_000,
  /** Percent of net income that may go to credit. */
  minDebtShare: 10,
  maxDebtShare: 60,
  /** Percent of the price. */
  maxPurchaseCostsRate: 30,
  /** Percent of the price the lender may lend. */
  minLoanToValue: 50,
  maxLoanToValue: 100,
  maxTermYears: MORTGAGE_LIMITS.maxTermYears,
  maxAnnualRate: MORTGAGE_LIMITS.maxAnnualRate,
  /** A loan smaller than the mortgage calculator's minimum counts as no loan. */
  minLoanAmount: MORTGAGE_LIMITS.minLoanAmount,
  /** Beyond the mortgage calculator's largest loan the result is out of range. */
  maxLoanAmount: MORTGAGE_LIMITS.maxLoanAmount,
} as const;

/** The household the page's worked example describes; the calculator starts from it. */
export const BORROWING_CAPACITY_EXAMPLE = {
  monthlyIncome: 3200,
  existingPayments: 250,
  maxDebtShare: 35,
  annualRate: 3.5,
  termYears: 30,
  savings: 40_000,
  purchaseCostsRate: 7,
  maxLoanToValue: 90,
} as const satisfies BorrowingCapacityInput;

/** The extra monthly income the "each extra" line of the result is worked out for. */
export const BORROWING_CAPACITY_INCOME_STEP = 100;

export type BorrowingCapacityInput = {
  /** Net monthly household income, after tax and social contributions. */
  monthlyIncome: number;
  /** Credit payments already made each month. Empty (NaN) reads as none. */
  existingPayments: number;
  /** Largest share of net income, in percent, that all credit payments together may take. */
  maxDebtShare: number;
  /** Nominal annual rate of the new loan, in percent. Required, as in the mortgage calculator. */
  annualRate: number;
  /** Term of the new loan in years; fractions are rounded to the nearest month. */
  termYears: number;
  /** Savings that can go into the purchase. Empty (NaN) reads as none. */
  savings: number;
  /** One-off purchase costs (taxes, fees, notary) in percent of the price. Empty reads as 0%. */
  purchaseCostsRate: number;
  /** Largest loan, in percent of the price. */
  maxLoanToValue: number;
};

export type BorrowingCapacityField = keyof BorrowingCapacityInput;

export type BorrowingCapacityInputError = "required" | "tooSmall" | "tooLarge" | "negative";

/** Which limit sets the price: the monthly budget, the upfront cash, or both at once. */
export type BorrowingCapacityLimit = "monthly" | "cash" | "both";

export type MonthlyLimit = {
  /** Income × the maximum debt share: what all credit payments together may take. */
  allowedPayments: number;
  existingPayments: number;
  /** Room left for the new loan's payment; 0 when existing payments use it all. */
  maxNewPayment: number;
  /**
   * The largest loan that payment repays at the rate and term, rounded down to the cent; 0 when
   * there is no room, or room only for a loan under the minimum.
   */
  maxLoan: number;
  hasRoom: boolean;
  /** Highest price this limit allows, with all the savings going into the purchase. */
  priceCeiling: number;
};

export type CashLimit = {
  savings: number;
  /** Percent of the price the lender may lend. */
  loanToValue: number;
  /** Percent of the price the down payment has to cover: 100% − the loan-to-value. */
  depositShare: number;
  purchaseCostsRate: number;
  /** Percent of the price that has to come from savings: the deposit plus the costs. */
  cashShare: number;
  /** Highest price the savings cover; null when nothing has to come from savings. */
  priceCeiling: number | null;
};

/** What would take the binding limit up to the other one. */
export type BorrowingCapacityLift =
  /** About this much more net income a month (whole euros) reaches `price`, the cash limit. */
  | { kind: "income"; extraMonthlyIncome: number; price: number }
  /** No cash limit to reach: each `step` euros of monthly income adds about `priceIncrease`. */
  | { kind: "incomeStep"; step: number; priceIncrease: number }
  /** About this much more savings (whole euros) reaches `price`, the monthly limit. */
  | { kind: "savings"; extraSavings: number; price: number };

export type BorrowingCapacityResult =
  | {
      status: "ok";
      monthly: MonthlyLimit;
      cash: CashLimit;
      binding: BorrowingCapacityLimit;
      /** Highest price both limits allow. */
      price: number;
      loan: number;
      downPayment: number;
      purchaseCosts: number;
      /** Down payment plus purchase costs: what comes out of savings. */
      cashNeeded: number;
      /** The loan's payments from the mortgage calculator; null without a loan. */
      mortgage: MortgageResult | null;
      /** The debt-to-income ratio with the new payment added to the existing ones. */
      debtToIncome: DebtToIncomeResult;
      lift: BorrowingCapacityLift | null;
    }
  | {
      /** The loan would be larger than the mortgage calculator works out. */
      status: "outOfRange";
      monthly: MonthlyLimit;
      cash: CashLimit;
    };

export type BorrowingCapacityCalculation =
  | { ok: true; result: BorrowingCapacityResult }
  | {
      ok: false;
      errors: Partial<Record<BorrowingCapacityField, BorrowingCapacityInputError>>;
    };

type Errors = Partial<Record<BorrowingCapacityField, BorrowingCapacityInputError>>;

const L = BORROWING_CAPACITY_LIMITS;

function validate(input: BorrowingCapacityInput): Errors {
  const errors: Errors = {};
  const {
    monthlyIncome,
    existingPayments,
    maxDebtShare,
    annualRate,
    termYears,
    savings,
    purchaseCostsRate,
    maxLoanToValue,
  } = input;

  if (Number.isNaN(monthlyIncome) || monthlyIncome <= 0) errors.monthlyIncome = "required";
  else if (monthlyIncome > L.maxMonthlyAmount) errors.monthlyIncome = "tooLarge";

  if (existingPayments < 0) errors.existingPayments = "negative";
  else if (existingPayments > L.maxMonthlyAmount) errors.existingPayments = "tooLarge";

  if (Number.isNaN(maxDebtShare)) errors.maxDebtShare = "required";
  else if (maxDebtShare < L.minDebtShare) errors.maxDebtShare = "tooSmall";
  else if (maxDebtShare > L.maxDebtShare) errors.maxDebtShare = "tooLarge";

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > L.maxAnnualRate) errors.annualRate = "tooLarge";

  if (Number.isNaN(termYears) || Math.round(termYears * 12) < 1) errors.termYears = "required";
  else if (termYears > L.maxTermYears) errors.termYears = "tooLarge";

  if (savings < 0) errors.savings = "negative";
  else if (savings > L.maxSavings) errors.savings = "tooLarge";

  if (purchaseCostsRate < 0) errors.purchaseCostsRate = "negative";
  else if (purchaseCostsRate > L.maxPurchaseCostsRate) errors.purchaseCostsRate = "tooLarge";

  if (Number.isNaN(maxLoanToValue)) errors.maxLoanToValue = "required";
  else if (maxLoanToValue < L.minLoanToValue) errors.maxLoanToValue = "tooSmall";
  else if (maxLoanToValue > L.maxLoanToValue) errors.maxLoanToValue = "tooLarge";

  return errors;
}

const orZero = (value: number) => (Number.isNaN(value) ? 0 : value);
const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;
/** Percent to hundredths of a percent: 35 → 3500, 7.25 → 725. */
const toBasisPoints = (percent: number) => Math.round(percent * 100);
const BP = 10_000;

/**
 * Rounds down, letting through the last bit of floating-point noise so that an exact product
 * such as 3,200 × 35% isn't floored a cent short.
 */
const floorCents = (value: number) => Math.floor(value + 1e-6);
const ceilCents = (value: number) => Math.ceil(value - 1e-6);

/**
 * How many euros of loan one euro of level monthly payment repays: (1 − (1 + r)^−n) ÷ r, the
 * same level-payment formula the mortgage calculator uses.
 */
function annuityFactor(monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return months;
  return -Math.expm1(-months * Math.log1p(monthlyRate)) / monthlyRate;
}

export function computeBorrowingCapacity(
  input: BorrowingCapacityInput,
): BorrowingCapacityCalculation {
  const errors = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const annualRate = input.annualRate;
  const termYears = input.termYears;
  const months = Math.round(termYears * 12);
  const factor = annuityFactor(annualRate / 100 / 12, months);

  const incomeCents = toCents(input.monthlyIncome);
  const existingCents = toCents(orZero(input.existingPayments));
  const savingsCents = toCents(orZero(input.savings));
  const shareBp = toBasisPoints(input.maxDebtShare);
  const costsBp = toBasisPoints(orZero(input.purchaseCostsRate));
  const ltvBp = toBasisPoints(input.maxLoanToValue);
  const cashBp = BP - ltvBp + costsBp;

  const paymentFor = (loanCents: number) => {
    const mortgage = computeMortgage({
      loanAmount: fromCents(loanCents),
      termYears,
      annualRate,
      monthlyFees: 0,
    });
    if (!mortgage.ok) throw new Error("The mortgage calculator rejected a loan it should take");
    return mortgage.result;
  };

  // 1. Monthly limit.
  const allowedCents = floorCents((incomeCents * shareBp) / BP);
  const maxNewPaymentCents = Math.max(0, allowedCents - existingCents);
  let maxLoanCents = floorCents(maxNewPaymentCents * factor);
  if (maxLoanCents < toCents(L.minLoanAmount)) maxLoanCents = 0;
  // The mortgage calculator rounds each payment to the cent; make sure its payment for this
  // loan fits the room, as the unrounded formula says it does.
  if (maxLoanCents > 0 && maxLoanCents <= toCents(L.maxLoanAmount)) {
    for (let guard = 0; guard < 10; guard++) {
      if (toCents(paymentFor(maxLoanCents).monthlyPayment) <= maxNewPaymentCents) break;
      maxLoanCents -= 1;
    }
  }
  const incomeCeilingCents = floorCents(((maxLoanCents + savingsCents) * BP) / (BP + costsBp));

  // 2. Upfront cash limit.
  const cashCeilingCents =
    cashBp === 0 ? Number.POSITIVE_INFINITY : floorCents((savingsCents * BP) / cashBp);

  const monthly: MonthlyLimit = {
    allowedPayments: fromCents(allowedCents),
    existingPayments: fromCents(existingCents),
    maxNewPayment: fromCents(maxNewPaymentCents),
    maxLoan: fromCents(maxLoanCents),
    hasRoom: maxLoanCents > 0,
    priceCeiling: fromCents(incomeCeilingCents),
  };
  const cash: CashLimit = {
    savings: fromCents(savingsCents),
    loanToValue: ltvBp / 100,
    depositShare: (BP - ltvBp) / 100,
    purchaseCostsRate: costsBp / 100,
    cashShare: cashBp / 100,
    priceCeiling: cashBp === 0 ? null : fromCents(cashCeilingCents),
  };

  const binding: BorrowingCapacityLimit =
    incomeCeilingCents < cashCeilingCents
      ? "monthly"
      : incomeCeilingCents > cashCeilingCents
        ? "cash"
        : "both";

  // 3. The highest price both allow. At a given price the savings pay the costs first and the
  // rest goes to the down payment; the loan is what is still missing. Rounding the costs to the
  // cent can push that a cent past a limit, so step down until every limit holds.
  const costsFor = (priceCents: number) => Math.round((priceCents * costsBp) / BP);
  const loanFor = (priceCents: number) =>
    Math.max(0, priceCents + costsFor(priceCents) - savingsCents);
  const fits = (priceCents: number) => {
    const loanCents = loanFor(priceCents);
    return loanCents <= maxLoanCents && loanCents * BP <= priceCents * ltvBp;
  };

  let priceCents = Math.min(incomeCeilingCents, cashCeilingCents);
  for (let guard = 0; guard < 100 && priceCents > 0 && !fits(priceCents); guard++) priceCents -= 1;

  // A loan under the minimum isn't a loan: buy with savings alone instead.
  if (loanFor(priceCents) > 0 && loanFor(priceCents) < toCents(L.minLoanAmount)) {
    priceCents = floorCents((savingsCents * BP) / (BP + costsBp));
    for (let guard = 0; guard < 100 && priceCents > 0 && loanFor(priceCents) > 0; guard++) {
      priceCents -= 1;
    }
  }

  const loanCents = loanFor(priceCents);
  if (loanCents > toCents(L.maxLoanAmount)) {
    return { ok: true, result: { status: "outOfRange", monthly, cash } };
  }

  const purchaseCostsCents = costsFor(priceCents);
  const downPaymentCents = priceCents - loanCents;
  const mortgage = loanCents > 0 ? paymentFor(loanCents) : null;

  const debtToIncome = computeDebtToIncome({
    monthlyIncome: fromCents(incomeCents),
    payments: [fromCents(existingCents), mortgage?.monthlyPayment ?? 0],
  });

  return {
    ok: true,
    result: {
      status: "ok",
      monthly,
      cash,
      binding,
      price: fromCents(priceCents),
      loan: fromCents(loanCents),
      downPayment: fromCents(downPaymentCents),
      purchaseCosts: fromCents(purchaseCostsCents),
      cashNeeded: fromCents(downPaymentCents + purchaseCostsCents),
      mortgage,
      debtToIncome,
      lift: liftFor(binding),
    },
  };

  function liftFor(limit: BorrowingCapacityLimit): BorrowingCapacityLift | null {
    if (limit === "both") return null;

    if (limit === "cash") {
      // Savings at which the cash limit meets the monthly one: S × LTV = loan × cash share.
      const neededSavingsCents = ceilCents((maxLoanCents * cashBp) / ltvBp);
      return {
        kind: "savings",
        extraSavings: Math.max(1, Math.ceil((neededSavingsCents - savingsCents) / 100)),
        price: fromCents(floorCents(((maxLoanCents + neededSavingsCents) * BP) / (BP + costsBp))),
      };
    }

    if (!Number.isFinite(cashCeilingCents)) {
      const extraPaymentCents = (BORROWING_CAPACITY_INCOME_STEP * 100 * shareBp) / BP;
      return {
        kind: "incomeStep",
        step: BORROWING_CAPACITY_INCOME_STEP,
        priceIncrease: fromCents(floorCents((extraPaymentCents * factor * BP) / (BP + costsBp))),
      };
    }

    // Income at which the monthly limit reaches the cash one: the loan that price needs, the
    // payment that repays it, and the income whose allowed share covers that payment.
    const neededLoanCents =
      ceilCents((cashCeilingCents * (BP + costsBp)) / BP) - savingsCents;
    const neededPaymentCents = ceilCents(neededLoanCents / factor);
    const neededIncomeCents = ceilCents(((neededPaymentCents + existingCents) * BP) / shareBp);
    return {
      kind: "income",
      extraMonthlyIncome: Math.max(1, Math.ceil((neededIncomeCents - incomeCents) / 100)),
      price: fromCents(cashCeilingCents),
    };
  }
}
