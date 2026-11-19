import { amortizeLevelPayment, monthlyRateFromAnnual, totalInterestCents } from "./amortization";
import { annualPercentageRate } from "./personalLoan";

export const CAR_LOAN_LIMITS = {
  price: 1_000_000,
  deposit: 1_000_000,
  termMonths: 120,
  annualRate: 40,
  upfrontFees: 100_000,
  monthlyFees: 10_000,
  monthlyFuel: 10_000,
  annualInsurance: 100_000,
  annualTax: 100_000,
  annualMaintenance: 100_000,
} as const;

export type CarLoanField = keyof typeof CAR_LOAN_LIMITS;
export type CarLoanInput = Record<CarLoanField, number>;
type FieldError = "required" | "negative" | "tooLarge" | "term" | "deposit";

export const CAR_LOAN_EXAMPLE: CarLoanInput = {
  price: 20_000,
  deposit: 5_000,
  termMonths: 60,
  annualRate: 6,
  upfrontFees: 250,
  monthlyFees: 5,
  monthlyFuel: 100,
  annualInsurance: 600,
  annualTax: 120,
  annualMaintenance: 480,
};

const fields = Object.keys(CAR_LOAN_LIMITS) as CarLoanField[];
const financeFields: ReadonlySet<CarLoanField> = new Set([
  "termMonths", "annualRate", "upfrontFees", "monthlyFees",
]);
const cents = (value: number) => Math.round(value * 100);

export function isCashPurchase(input: CarLoanInput) {
  return Number.isFinite(input.price) && input.price >= 0
    && cents(input.price) === cents(input.deposit);
}

export function computeCarLoan(input: CarLoanInput) {
  const cash = isCashPurchase(input);
  const errors: Partial<Record<CarLoanField, FieldError>> = {};
  for (const field of fields) {
    if (cash && financeFields.has(field)) continue;

    const value = input[field];
    if (Number.isNaN(value)) {
      errors[field] = "required";
    } else if (value < 0) {
      errors[field] = "negative";
    } else if (value > CAR_LOAN_LIMITS[field]) {
      errors[field] = "tooLarge";
    } else if (field === "termMonths" && (value < 1 || !Number.isInteger(value))) {
      errors[field] = "term";
    }
  }

  const principal = cents(input.price) - cents(input.deposit);
  if (!errors.price && !errors.deposit && principal < 0) errors.deposit = "deposit";
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const upfront = cash ? 0 : cents(input.upfrontFees);
  const monthlyFee = cash ? 0 : cents(input.monthlyFees);
  const schedule = cash
    ? []
    : amortizeLevelPayment(principal, monthlyRateFromAnnual(input.annualRate), input.termMonths);
  const payments = schedule.map((row) => row.paymentCents + monthlyFee);
  const interest = totalInterestCents(schedule);
  const financingCost = interest + upfront + monthlyFee * schedule.length;
  const runningCosts = {
    monthlyFuel: cents(input.monthlyFuel),
    annualInsurance: Math.round(cents(input.annualInsurance) / 12),
    annualTax: Math.round(cents(input.annualTax) / 12),
    annualMaintenance: Math.round(cents(input.annualMaintenance) / 12),
  };
  const monthlyRunning = Object.values(runningCosts).reduce((total, cost) => total + cost, 0);
  const monthlyPayment = payments[0] ?? 0;
  const cashAtPurchase = cents(input.deposit) + upfront;

  return {
    ok: true as const,
    result: {
      financedAmount: principal / 100,
      monthlyPayment: monthlyPayment / 100,
      monthlyRunning: monthlyRunning / 100,
      monthlyBudget: (monthlyRunning + monthlyPayment) / 100,
      monthlyFuel: runningCosts.monthlyFuel / 100,
      monthlyInsurance: runningCosts.annualInsurance / 100,
      monthlyTax: runningCosts.annualTax / 100,
      monthlyMaintenance: runningCosts.annualMaintenance / 100,
      cashAtPurchase: cashAtPurchase / 100,
      financingCost: financingCost / 100,
      purchaseWithFinancing: (cents(input.price) + financingCost) / 100,
      apr: principal > upfront ? annualPercentageRate(principal - upfront, payments) : null,
    },
  };
}
