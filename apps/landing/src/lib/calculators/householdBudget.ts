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
  /**
   * Percent of total income to one decimal; null without income. Rounded
   * together with the other categories and the surplus (largest remainder),
   * so the shown shares add up to the shown totals.
   */
  shareOfIncome: number | null;
};

export type HouseholdBudgetResult = {
  status: HouseholdBudgetStatus;
  totalIncome: number;
  totalExpenses: number;
  /** Income minus expenses: positive is a surplus, negative a deficit. */
  balance: number;
  /** Total expenses as a percent of income: the sum of the category shares; null without income. */
  expensesShareOfIncome: number | null;
  /** Balance as a percent of income, 100 minus the expenses share; null without income. */
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

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An entered amount as the budget counts it: rounded to the cent, with empty,
 * negative and non-finite amounts as 0 and huge ones capped.
 */
export function toBudgetAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundToCents(Math.min(value, BUDGET_MAX_AMOUNT));
}

function sumAmounts(amounts: ReadonlyArray<number>): number {
  return roundToCents(amounts.reduce((sum, amount) => sum + toBudgetAmount(amount), 0));
}

/**
 * Splits `target` tenths of a percent across `raw` (each part's exact share in
 * tenths) by largest remainder: every part gets its whole tenths, and the
 * tenths left over go to the parts with the largest fractions, earliest first
 * on a tie. The result always adds up to `target`.
 */
export function allocateTenths(raw: ReadonlyArray<number>, target: number): number[] {
  const floors = raw.map((value) => Math.floor(value));
  let remaining = target - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remaining > 0 && order.length > 0; i = (i + 1) % order.length) {
    floors[order[i].index] += 1;
    remaining -= 1;
  }
  return floors;
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

  const categoryTotals = BUDGET_CATEGORIES.map((category) => ({
    category,
    total: sumAmounts(
      params.expenses.filter((row) => row.category === category).map((row) => row.amount),
    ),
  }));

  if (totalIncome === 0) {
    return {
      status: statusOf(totalIncome, totalExpenses),
      totalIncome,
      totalExpenses,
      balance,
      expensesShareOfIncome: null,
      savingsRate: null,
      categories: categoryTotals.map((entry) => ({ ...entry, shareOfIncome: null })),
    };
  }

  // Shares in tenths of a percent. With a surplus, the categories and the
  // surplus split exactly 100%; with a deficit, the categories split the
  // expenses' share of income, rounded once.
  const toTenths = (amount: number) => (amount / totalIncome) * 1000;
  const parts = categoryTotals.map((entry) => toTenths(entry.total));
  if (balance > 0) parts.push(toTenths(balance));
  const target = balance >= 0 ? 1000 : Math.round(toTenths(totalExpenses));
  const tenths = allocateTenths(parts, target);
  const expensesTenths = tenths
    .slice(0, categoryTotals.length)
    .reduce((sum, value) => sum + value, 0);

  return {
    status: statusOf(totalIncome, totalExpenses),
    totalIncome,
    totalExpenses,
    balance,
    expensesShareOfIncome: expensesTenths / 10,
    savingsRate: (1000 - expensesTenths) / 10,
    categories: categoryTotals.map((entry, index) => ({ ...entry, shareOfIncome: tenths[index] / 10 })),
  };
}
