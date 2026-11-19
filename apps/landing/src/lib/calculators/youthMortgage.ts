/**
 * Youth mortgage scenario for Portugal: an informational checklist of the public guarantee
 * conditions (Decreto-Lei n.º 44/2024) and, separately, a payment and upfront cash estimate.
 *
 * The checklist never says a person is eligible: banks decide. It only reports which conditions
 * the entered answers meet. The estimate reuses the shared loan engine (`./mortgage`) and the
 * purchase taxes (`./purchaseTaxes`, IMT and Imposto do Selo with the young-buyer exemption).
 */
import { computeMortgage } from "./mortgage";
import { computePurchaseTaxes } from "./purchaseTaxes";

export const YOUTH_GUARANTEE = {
  reviewedOn: "2026-11-19",
  minAge: 18,
  maxAge: 35,
  /** Maximum price of the home, in euros (portugal.gov.pt, Literacia Financeira). */
  maxPrice: 450_000,
  /**
   * Upper limit of the 8th IRS bracket in euros a year: article 68 of the IRS Code for 2026,
   * the 2025 limit (83,696) updated by 3.51% in Lei n.º 73-A/2025 (State Budget 2026).
   */
  maxIncome: 86_634,
  /** Share of the transaction value the State can guarantee, in percent. */
  guaranteePercent: 15,
  /** Contracts signed up to this date can use the guarantee. */
  lastContractDate: "2026-12-31",
  sources: {
    government: "https://portugal.gov.pt/gc24/comunicacao/noticias/garantia-publica-o-que-e-e-como-funciona",
    literacia: "https://www.literaciafinanceira.pt/artigos/credito-habitacao-jovem",
  },
} as const;

export const YOUTH_MORTGAGE_LIMITS = {
  price: 100_000_000,
  deposit: 100_000_000,
  annualRate: 30,
  maxTermYears: 40,
} as const;

export type ConditionId = "age" | "ownHome" | "otherProperty" | "price" | "income";
export type ConditionStatus = "met" | "notMet" | "unknown";

export interface GuaranteeInput {
  /** Age on the contract date; NaN when not entered. */
  age: number;
  /** Annual taxable income in euros; NaN when not entered. */
  income: number;
  /** The home will be the buyer's own permanent home. */
  ownPermanentHome: boolean;
  /** The buyer owns all or part of another residential property. */
  ownsOtherProperty: boolean;
  /** Purchase price; NaN or 0 when not entered. */
  price: number;
}

export function checkGuaranteeConditions(input: GuaranteeInput) {
  const known = (value: number) => Number.isFinite(value) && value > 0;
  const status = (value: boolean | null): ConditionStatus =>
    value === null ? "unknown" : value ? "met" : "notMet";
  const conditions: { id: ConditionId; status: ConditionStatus }[] = [
    {
      id: "age",
      status: status(
        Number.isFinite(input.age) && input.age > 0
          ? input.age >= YOUTH_GUARANTEE.minAge && input.age <= YOUTH_GUARANTEE.maxAge
          : null,
      ),
    },
    { id: "ownHome", status: status(input.ownPermanentHome) },
    { id: "otherProperty", status: status(!input.ownsOtherProperty) },
    { id: "price", status: status(known(input.price) ? input.price <= YOUTH_GUARANTEE.maxPrice : null) },
    { id: "income", status: status(known(input.income) ? input.income <= YOUTH_GUARANTEE.maxIncome : null) },
  ];
  return {
    conditions,
    met: conditions.filter((condition) => condition.status === "met").length,
    notMet: conditions.filter((condition) => condition.status === "notMet").length,
    total: conditions.length,
  };
}

export interface YouthMortgageInput {
  price: number;
  /** Cash put down; may be 0. */
  deposit: number;
  /** TAN, nominal annual rate in percent. */
  annualRate: number;
  termYears: number;
}

export const YOUTH_MORTGAGE_EXAMPLE: YouthMortgageInput = {
  price: 250_000,
  deposit: 0,
  annualRate: 3.5,
  termYears: 40,
};

export type YouthMortgageField = keyof YouthMortgageInput;
export type YouthMortgageError = "required" | "zero" | "negative" | "tooLarge" | "depositTooLarge" | "loanTooSmall";

export function computeYouthMortgage(input: YouthMortgageInput) {
  const errors: Partial<Record<YouthMortgageField, YouthMortgageError>> = {};
  const { price, deposit, annualRate, termYears } = input;
  if (Number.isNaN(price)) errors.price = "required";
  else if (price < 0) errors.price = "negative";
  else if (price === 0) errors.price = "zero";
  else if (price > YOUTH_MORTGAGE_LIMITS.price) errors.price = "tooLarge";

  if (Number.isNaN(deposit)) errors.deposit = "required";
  else if (deposit < 0) errors.deposit = "negative";
  else if (deposit > YOUTH_MORTGAGE_LIMITS.deposit) errors.deposit = "tooLarge";
  else if (!errors.price && deposit > price) errors.deposit = "depositTooLarge";

  if (Number.isNaN(annualRate)) errors.annualRate = "required";
  else if (annualRate < 0) errors.annualRate = "negative";
  else if (annualRate > YOUTH_MORTGAGE_LIMITS.annualRate) errors.annualRate = "tooLarge";

  if (Number.isNaN(termYears) || Math.round(termYears * 12) < 1) errors.termYears = "required";
  else if (termYears > YOUTH_MORTGAGE_LIMITS.maxTermYears) errors.termYears = "tooLarge";

  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const loanCents = Math.round(price * 100) - Math.round(deposit * 100);
  const loan = loanCents / 100;
  let monthlyPayment = 0;
  let totalInterest = 0;
  if (loan > 0) {
    const mortgage = computeMortgage({ loanAmount: loan, termYears, annualRate, monthlyFees: 0 });
    if (!mortgage.ok) return { ok: false as const, errors: { deposit: "loanTooSmall" as const } };
    monthlyPayment = mortgage.result.monthlyPayment;
    totalInterest = mortgage.result.totalInterest;
  }

  const taxes = (young: boolean) => {
    const calculation = computePurchaseTaxes({
      price, taxValue: 0, loan, region: "mainland", use: "ownPermanent", young,
    });
    if (!calculation.ok) throw new Error("Purchase taxes rejected a validated input");
    return calculation.result;
  };
  const without = taxes(false);
  const withYoung = taxes(true);
  const cents = (value: number) => Math.round(value * 100);

  return {
    ok: true as const,
    result: {
      loan,
      /** Loan to value, in percent of the price. */
      ltv: (loanCents / cents(price)) * 100,
      monthlyPayment,
      totalInterest,
      taxesWithout: without.total,
      taxesWithYoung: withYoung.total,
      youngExemption: withYoung.exemption,
      youngSaving: withYoung.youngSaving,
      cashWithout: (cents(deposit) + cents(without.total)) / 100,
      cashWithYoung: (cents(deposit) + cents(withYoung.total)) / 100,
    },
  };
}
