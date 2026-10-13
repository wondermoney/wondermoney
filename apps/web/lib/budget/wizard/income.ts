import {
  convertMonthlyAmountToAnuallizedMonthlyAmount,
  convertRecurrencyIntoMonthsInYear,
} from "@/lib/utils/recurrency";

import type {
  StoredMonthlyEquivalentIncome,
  WizardIncome,
} from "./types";

export function calculateAnnualIncome(incomes: WizardIncome[]) {
  return incomes.reduce((acc, income) => {
    const months = income.recurrency
      ? convertRecurrencyIntoMonthsInYear(income.recurrency)
      : 1;
    const incomeAnnualTotal = income.isRecurrent
      ? income.amount * months
      : income.amount;

    return acc + incomeAnnualTotal;
  }, 0);
}

export function calculateAverageMonthlyIncome(incomes: WizardIncome[]) {
  return calculateAnnualIncome(incomes) / 12;
}

// Budget API response income amounts currently use the monthly-equivalent
// value submitted by the wizard, so recurrency must not be applied again.
export function calculateStoredMonthlyEquivalentAnnualIncome(
  incomes: StoredMonthlyEquivalentIncome[],
) {
  return incomes.reduce((acc, income) => acc + income.amount * 12, 0);
}

export function toBudgetCreateIncomes(incomes: WizardIncome[]) {
  return incomes.map((income) => ({
    ...income,
    amount: income.isRecurrent
      ? convertMonthlyAmountToAnuallizedMonthlyAmount(
          income.amount,
          income.recurrency
            ? convertRecurrencyIntoMonthsInYear(income.recurrency)
            : 12,
        )
      : convertMonthlyAmountToAnuallizedMonthlyAmount(income.amount, 1),
  }));
}

export function replaceIncomeById<T extends WizardIncome>(
  incomes: T[],
  nextIncome: T,
) {
  return incomes.map((income) =>
    income.id === nextIncome.id ? nextIncome : income,
  );
}

export function shouldAddCreatedCategoryToBudget({
  parentCategoryKey,
  budgetAmount,
}: {
  parentCategoryKey?: string | null;
  budgetAmount?: number;
}) {
  return !!parentCategoryKey && !!budgetAmount && budgetAmount > 0;
}
