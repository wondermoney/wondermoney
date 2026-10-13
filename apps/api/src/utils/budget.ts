import { Category } from '@entity/Category';

export enum Recurrency {
  ANNUALLY = 'ANNUALLY',
  BI_ANNUALLY = 'BI_ANNUALLY',
  MONTHLY = 'MONTHLY',
  MONTHLY_14 = 'MONTHLY_14',
  QUARTERLY = 'QUARTERLY',
}

export function getMonthsFromRecurrency(recurrency: Recurrency) {
  switch (recurrency) {
    case Recurrency.ANNUALLY:
      return 1;
    case Recurrency.BI_ANNUALLY:
      return 2;
    case Recurrency.MONTHLY:
      return 12;
    case Recurrency.MONTHLY_14:
      return 14;
    case Recurrency.QUARTERLY:
      return 4;
  }
}

export const convertRecurrencyIntoMonthsInYear = (recurrency: string): number => {
  switch (recurrency) {
    case 'ANNUALLY':
      return 1;
    case 'BI_ANNUALLY':
      return 2;
    case 'MONTHLY':
      return 12;
    case 'MONTHLY_14':
      return 14;
    case 'QUARTERLY':
      return 4;
    default:
      return 1;
  }
};

export const convertRecurrencyMonthsIntoString = (recurrency: number): Recurrency => {
  switch (recurrency) {
    case 1:
      return Recurrency.ANNUALLY;
    case 2:
      return Recurrency.BI_ANNUALLY;
    case 4:
      return Recurrency.QUARTERLY;
    case 12:
      return Recurrency.MONTHLY;
    case 14:
      return Recurrency.MONTHLY_14;
    default:
      return Recurrency.ANNUALLY;
  }
};

export const convertToMonthlyAmount = (amount: number, recurrency: Recurrency | string): number => {
  const monthsInYear =
    typeof recurrency === 'string'
      ? convertRecurrencyIntoMonthsInYear(recurrency)
      : getMonthsFromRecurrency(recurrency);

  return (amount * monthsInYear) / 12;
};

/**
 * Calculate total monthly household income from an array of incomes with different recurrencies
 * @param incomes Array of income objects with amount and recurrency
 * @returns Total monthly household income
 */
export const calculateTotalMonthlyIncome = (
  incomes: { amount: number; isRecurrent?: boolean; recurrency: Recurrency | string; }[],
): number => {
  return incomes.reduce((acc, income) => {
    // Convert income to monthly amount based on its recurrency
    const monthlyAmount =
      income.isRecurrent !== false && income.recurrency
        ? convertToMonthlyAmount(income.amount, income.recurrency)
        : income.amount; // Assume one-time incomes are already monthly
    return acc + monthlyAmount;
  }, 0);
};

const MONTHS_IN_YEAR = 12;

function calculateAmountBudgeted({
  category,
  numAdults,
  numDependents,
  totalHouseholdAnualizedMonthlyIncome,
}: {
  category: Category;
  numAdults: number;
  numDependents: number;
  totalHouseholdAnualizedMonthlyIncome: number;
}) {
  const householdSize = numAdults + numDependents;
  let amountBudgeted = 0;

  // default household amount
  amountBudgeted += 1 * category.defaultHouseholdAmount;

  const monthsFromRecurrency = getMonthsFromRecurrency(category.recurrency);

  // default household multiplier
  amountBudgeted +=
    (totalHouseholdAnualizedMonthlyIncome * category.defaultHouseholdMultiplier * monthsFromRecurrency) /
    MONTHS_IN_YEAR;

  // default individual amount
  amountBudgeted += (householdSize * category.defaultIndividualAmount * monthsFromRecurrency) / MONTHS_IN_YEAR;

  // default individual adult amount
  amountBudgeted += (numAdults * category.defaultIndividualAdultAmount * monthsFromRecurrency) / MONTHS_IN_YEAR;

  // default individual multiplier
  amountBudgeted +=
    (totalHouseholdAnualizedMonthlyIncome *
      category.defaultIndividualMultiplier *
      householdSize *
      monthsFromRecurrency) /
    MONTHS_IN_YEAR;

  // default individual adult multiplier
  amountBudgeted +=
    (totalHouseholdAnualizedMonthlyIncome *
      category.defaultIndividualAdultMultiplier *
      numAdults *
      monthsFromRecurrency) /
    MONTHS_IN_YEAR;

  // default individual dependent amount
  amountBudgeted += (numDependents * category.defaultIndividualDependentAmount * monthsFromRecurrency) / MONTHS_IN_YEAR;

  // default individual dependent multiplier
  amountBudgeted +=
    (totalHouseholdAnualizedMonthlyIncome *
      category.defaultIndividualDependentMultiplier *
      numDependents *
      monthsFromRecurrency) /
    MONTHS_IN_YEAR;

  return amountBudgeted;
}

export { calculateAmountBudgeted };
