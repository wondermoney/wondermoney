/**
 * Household budget: monthly income against monthly expenses grouped into a
 * fixed set of categories. Everything is per month and in one currency; the
 * page never stores or sends the figures.
 */

export const BUDGET_CATEGORIES = [
  "housing",
  "food",
  "transport",
  "utilities",
  "health",
  "debtPayments",
  "leisure",
  "other",
] as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** The largest amount a single row counts for, so sums and ratios stay finite. */
export const BUDGET_MAX_AMOUNT = 1_000_000_000_000;

export type IncomeRow = {
  id: string;
  amount: number;
};

export type ExpenseRow = {
  id: string;
  category: BudgetCategory;
  amount: number;
};

export type HouseholdBudgetParams = {
  incomes: ReadonlyArray<IncomeRow>;
  expenses: ReadonlyArray<ExpenseRow>;
};

/**
 * - `surplus`: income is above expenses.
 * - `balanced`: expenses use up the income exactly.
 * - `deficit`: expenses are above a positive income.
 * - `noIncome`: there are expenses but no income, so no rate or shares.
 * - `empty`: nothing entered.
 */
export type HouseholdBudgetStatus = "surplus" | "balanced" | "deficit" | "noIncome" | "empty";

export type CategoryTotal = {
  category: BudgetCategory;
  total: number;
  /** Percent of total income, rounded to one decimal; null without income. */
  shareOfIncome: number | null;
};

export type HouseholdBudgetResult = {
  status: HouseholdBudgetStatus;
  totalIncome: number;
  totalExpenses: number;
  /** Income minus expenses: positive is a surplus, negative a deficit. */
  balance: number;
  /** Total expenses as a percent of income, rounded to one decimal; null without income. */
  expensesShareOfIncome: number | null;
  /** Balance as a percent of income, rounded to one decimal; null without income. */
  savingsRate: number | null;
  /** Every category in `BUDGET_CATEGORIES` order, including empty ones. */
  categories: CategoryTotal[];
};

/** The household the page's worked example describes; the calculator starts from it. */
export const HOUSEHOLD_BUDGET_WORKED_EXAMPLE = {
  incomes: [
    { id: "salary", amount: 2700 },
    { id: "other", amount: 150 },
  ],
  expenses: [
    { id: "rent", category: "housing", amount: 850 },
    { id: "groceries", category: "food", amount: 480 },
    { id: "transport", category: "transport", amount: 210 },
    { id: "energy", category: "utilities", amount: 110 },
    { id: "telecom", category: "utilities", amount: 50 },
    { id: "health", category: "health", amount: 60 },
    { id: "loans", category: "debtPayments", amount: 150 },
    { id: "leisure", category: "leisure", amount: 180 },
    { id: "other", category: "other", amount: 120 },
  ],
} as const satisfies HouseholdBudgetParams;

/** An entered amount as the budget counts it: empty, negative and non-finite are 0, huge is capped. */
export function toBudgetAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, BUDGET_MAX_AMOUNT);
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumAmounts(amounts: ReadonlyArray<number>): number {
  return roundToCents(amounts.reduce((sum, amount) => sum + toBudgetAmount(amount), 0));
}

function percentOf(value: number, income: number): number | null {
  if (income === 0) return null;
  return roundToOneDecimal((value / income) * 100);
}

function statusOf(totalIncome: number, totalExpenses: number): HouseholdBudgetStatus {
  if (totalIncome === 0) return totalExpenses === 0 ? "empty" : "noIncome";
  if (totalExpenses < totalIncome) return "surplus";
  if (totalExpenses === totalIncome) return "balanced";
  return "deficit";
}

export function computeHouseholdBudget(params: HouseholdBudgetParams): HouseholdBudgetResult {
  const totalIncome = sumAmounts(params.incomes.map((row) => row.amount));
  const totalExpenses = sumAmounts(params.expenses.map((row) => row.amount));
  const balance = roundToCents(totalIncome - totalExpenses);

  const categories = BUDGET_CATEGORIES.map((category) => {
    const total = sumAmounts(
      params.expenses.filter((row) => row.category === category).map((row) => row.amount),
    );
    return { category, total, shareOfIncome: percentOf(total, totalIncome) };
  });

  return {
    status: statusOf(totalIncome, totalExpenses),
    totalIncome,
    totalExpenses,
    balance,
    expensesShareOfIncome: percentOf(totalExpenses, totalIncome),
    savingsRate: percentOf(balance, totalIncome),
    categories,
  };
}
