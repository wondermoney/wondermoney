/**
 * Portuguese IRS capital gain on the sale of a property held as a private asset by an individual
 * tax resident. Educational estimate only.
 *
 * Rules (CIRS, Portal das Finanças text checked on 2026-11-20): the gain is the realisation value
 * (art. 44: the price, or the value the IMT of the sale was assessed on when higher, art. 44(2); IMT
 * is assessed on the higher of the price and the VPT, art. 12(1) CIMT) minus the acquisition value
 * (art. 46(1): the value the IMT of the purchase was assessed on) updated by the currency
 * devaluation coefficient (art. 50(1), when more than 24 months passed between acquisition and sale)
 * minus the works of the last 12 years and the necessary and effective acquisition and sale
 * expenses (art. 51(1)(a)); 50% of the gain is added to the other income (art. 43(2)(b)) and taxed
 * at the annual IRS brackets already kept in payroll.ts. A gain on the own permanent home is
 * excluded when the realisation value, net of the loan repaid, is reinvested in another one (art.
 * 10(5)(a)), in proportion to the amount reinvested (art. 10(12)). Not supported: non-residents,
 * properties acquired before 1989, companies, inheritances and gifts, proof of a lower price under
 * art. 44(5)-(6), solidarity surcharge and deductions from tax.
 *
 * Money is handled in integer cents internally and returned in euros.
 */
import { annualBracketTaxCents } from "./payroll";

/** Hundredths of the coefficient for each acquisition year (sales in 2026), Portaria n.º 457/2026/1. */
function byYears(hundredths: number, from: number, to = from): Array<[number, number]> {
  return Array.from({ length: to - from + 1 }, (_, index) => [from + index, hundredths]);
}

export const CAPITAL_GAINS_TABLES = {
  saleYear: 2026,
  reviewed: "2026-11-20",
  portaria: "Portaria n.º 457/2026/1, de 15 de outubro",
  /** Properties acquired before 1 January 1989 have their own regime and are not supported. */
  firstYear: 1989,
  /** The coefficient applies when the property was held for more than this many months. */
  coefficientAfterMonths: 24,
  /** Share of the gain added to the income (art. 43(2)(b)), in basis points. */
  inclusionBp: 5000,
  coefficients: Object.fromEntries([
    ...byYears(100, 2025), ...byYears(102, 2024), ...byYears(104, 2023), ...byYears(108, 2022),
    ...byYears(119, 2021), ...byYears(120, 2018, 2020), ...byYears(121, 2017), ...byYears(122, 2016),
    ...byYears(123, 2012, 2015), ...byYears(127, 2011), ...byYears(131, 2010), ...byYears(133, 2009),
    ...byYears(131, 2008), ...byYears(135, 2007), ...byYears(137, 2006), ...byYears(143, 2005),
    ...byYears(146, 2004), ...byYears(148, 2003), ...byYears(152, 2002), ...byYears(158, 2001),
    ...byYears(171, 2000), ...byYears(174, 1999), ...byYears(176, 1998), ...byYears(181, 1997),
    ...byYears(184, 1996), ...byYears(188, 1995), ...byYears(196, 1994), ...byYears(205, 1993),
    ...byYears(223, 1992), ...byYears(243, 1991), ...byYears(275, 1990), ...byYears(307, 1989),
  ]) as Record<number, number>,
} as const;

export const CAPITAL_GAINS_LIMITS = { amount: 100_000_000 } as const;

export type CapitalGainsField =
  | "saleValue" | "taxValue" | "purchaseValue" | "purchaseYear" | "purchaseMonth" | "saleMonth" | "purchaseExpenses"
  | "worksExpenses" | "saleExpenses" | "otherIncome" | "reinvested" | "loanRepaid";
type FieldError =
  | "required" | "zero" | "negative" | "tooLarge" | "yearTooOld" | "yearTooNew" | "month"
  | "afterSale" | "loanTooLarge";

export interface CapitalGainsInput {
  /** Price received. */
  saleValue: number;
  /**
   * Valor patrimonial tributário (VPT) of the property at the sale. When above the price, the IMT of the sale is assessed
   * on it (art. 12(1) CIMT) and it becomes the realisation value (art. 44(2) CIRS). Empty (NaN), 0 or absent: not entered.
   */
  taxValue?: number;
  /** Value the IMT of the purchase was assessed on (art. 46(1) CIRS): the price, or the VPT then if higher. */
  purchaseValue: number;
  purchaseYear: number;
  purchaseMonth: number;
  /** Month of the sale, in the sale year. */
  saleMonth: number;
  /** IMT and Imposto do Selo paid at the purchase, plus other acquisition costs. */
  purchaseExpenses: number;
  /** Works of the last 12 years supported by invoices. */
  worksExpenses: number;
  /** Selling costs such as the agency fee. */
  saleExpenses: number;
  /** Other annual taxable income (rendimento coletável) of the household. */
  otherIncome: number;
  joint: boolean;
  ownPermanentHome: boolean;
  /** Amount reinvested in another own permanent home. */
  reinvested: number;
  /** Loan capital repaid with the proceeds of the sale. */
  loanRepaid: number;
}

export const CAPITAL_GAINS_EXAMPLE: CapitalGainsInput = {
  saleValue: 300_000, purchaseValue: 150_000, purchaseYear: 2012, purchaseMonth: 5, saleMonth: 6,
  purchaseExpenses: 6_000, worksExpenses: 10_000, saleExpenses: 9_000, otherIncome: 30_000,
  joint: false, ownPermanentHome: false, reinvested: 0, loanRepaid: 0,
};

const cents = (euros: number) => Math.round(euros * 100);
const euros = (value: number) => value / 100;

function checkAmount(value: number, { allowZero }: { allowZero: boolean }): FieldError | undefined {
  if (Number.isNaN(value)) return "required";
  if (value < 0) return "negative";
  if (value === 0 && !allowZero) return "zero";
  return value > CAPITAL_GAINS_LIMITS.amount ? "tooLarge" : undefined;
}

/** Extra IRS caused by adding `addedCents` to `otherCents`, with simple splitting for a couple. */
function extraIrsCents(otherCents: number, addedCents: number, joint: boolean): number {
  if (joint) {
    const half = (value: number) => annualBracketTaxCents(Math.round(value / 2));
    return 2 * (half(otherCents + addedCents) - half(otherCents));
  }
  return annualBracketTaxCents(otherCents + addedCents) - annualBracketTaxCents(otherCents);
}

export function computeCapitalGains(input: CapitalGainsInput) {
  const errors: Partial<Record<CapitalGainsField, FieldError>> = {};
  const set = (field: CapitalGainsField, error: FieldError | undefined) => {
    if (error) errors[field] = error;
  };
  set("saleValue", checkAmount(input.saleValue, { allowZero: false }));
  set("purchaseValue", checkAmount(input.purchaseValue, { allowZero: false }));
  const taxValueEntered = input.taxValue !== undefined && !Number.isNaN(input.taxValue);
  if (taxValueEntered) set("taxValue", checkAmount(input.taxValue!, { allowZero: true }));
  for (const field of ["purchaseExpenses", "worksExpenses", "saleExpenses", "otherIncome"] as const) {
    set(field, checkAmount(input[field], { allowZero: true }));
  }
  if (input.ownPermanentHome) {
    set("reinvested", checkAmount(input.reinvested, { allowZero: true }));
    set("loanRepaid", checkAmount(input.loanRepaid, { allowZero: true }));
    if (!errors.loanRepaid && input.loanRepaid > input.saleValue) errors.loanRepaid = "loanTooLarge";
  }
  const { saleYear, firstYear } = CAPITAL_GAINS_TABLES;
  if (!Number.isInteger(input.purchaseYear)) errors.purchaseYear = "required";
  else if (input.purchaseYear < firstYear) errors.purchaseYear = "yearTooOld";
  else if (input.purchaseYear > saleYear) errors.purchaseYear = "yearTooNew";
  for (const field of ["purchaseMonth", "saleMonth"] as const) {
    if (!Number.isInteger(input[field]) || input[field] < 1 || input[field] > 12) errors[field] = "month";
  }
  if (
    !errors.purchaseYear && !errors.purchaseMonth && !errors.saleMonth &&
    input.purchaseYear === saleYear && input.purchaseMonth > input.saleMonth
  ) {
    errors.purchaseMonth = "afterSale";
  }
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };

  const monthsHeld = (saleYear - input.purchaseYear) * 12 + input.saleMonth - input.purchaseMonth;
  const coefficientApplied = monthsHeld > CAPITAL_GAINS_TABLES.coefficientAfterMonths;
  const coefficientHundredths = coefficientApplied ? (CAPITAL_GAINS_TABLES.coefficients[input.purchaseYear] ?? 100) : 100;
  const saleCents = cents(input.saleValue);
  // Art. 44(2) CIRS: the value the IMT of the sale was assessed on prevails when higher than the price.
  const taxValueCents = taxValueEntered ? cents(input.taxValue!) : 0;
  const taxValueApplied = taxValueCents > saleCents;
  const realizationCents = taxValueApplied ? taxValueCents : saleCents;
  const adjustedPurchaseCents = Math.round((cents(input.purchaseValue) * coefficientHundredths) / 100);
  const expensesCents = cents(input.purchaseExpenses) + cents(input.worksExpenses) + cents(input.saleExpenses);
  const gainCents = realizationCents - adjustedPurchaseCents - expensesCents;

  const loanCents = input.ownPermanentHome ? cents(input.loanRepaid) : 0;
  // Art. 10(5)(a): the realisation value net of the loan repaid is what has to be reinvested.
  const reinvestableCents = realizationCents - loanCents;
  let exemptBp = 0;
  if (input.ownPermanentHome) {
    exemptBp = reinvestableCents <= 0
      ? 10_000
      : Math.min(10_000, Math.round((cents(input.reinvested) * 10_000) / reinvestableCents));
  }
  const taxableGainCents = gainCents > 0 ? Math.round((gainCents * (10_000 - exemptBp)) / 10_000) : 0;
  const includedCents = Math.round((taxableGainCents * CAPITAL_GAINS_TABLES.inclusionBp) / 10_000);
  const extraTaxCents = extraIrsCents(cents(input.otherIncome), includedCents, input.joint);
  const cashAfterCents = saleCents - cents(input.saleExpenses) - loanCents - extraTaxCents;

  return {
    ok: true as const,
    result: {
      monthsHeld,
      realizationValue: euros(realizationCents),
      taxValueApplied,
      coefficientApplied,
      coefficient: coefficientHundredths / 100,
      adjustedPurchase: euros(adjustedPurchaseCents),
      expenses: euros(expensesCents),
      gain: euros(gainCents),
      isLoss: gainCents < 0,
      exemptPercent: exemptBp / 100,
      taxableGain: euros(taxableGainCents),
      includedIncome: euros(includedCents),
      extraTax: euros(extraTaxCents),
      cashAfter: euros(cashAfterCents),
    },
  };
}
