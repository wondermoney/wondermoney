/**
 * The household budget guide's content for one locale (HouseholdBudgetGuide.astro): its
 * term lists, the worked example's figures and the method's formulas. Every figure comes
 * from `computeHouseholdBudget` on the worked example the calculator starts from, so the
 * guide can never quote other numbers than the calculator shows.
 */
import {
  Car,
  CreditCard,
  Ellipsis,
  HeartPulse,
  House,
  Percent,
  PiggyBank,
  Receipt,
  ShoppingBasket,
  Ticket,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  HOUSEHOLD_BUDGET_WORKED_EXAMPLE,
  computeHouseholdBudget,
  type BudgetCategory,
} from "@/lib/calculators/householdBudget";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import {
  fraction,
  number,
  operator,
  variable,
  type GuideFigure,
  type GuideFlowOperator,
  type GuideFormulaLine,
  type GuideTerm,
} from "./guideBlocks";

/** Stable ids of the notes the formulas link to: the same in every locale. */
export const HOUSEHOLD_BUDGET_GUIDE_IDS = {
  surplus: "household-budget-surplus",
  deficit: "household-budget-deficit",
  shares: "household-budget-shares",
  diagram: "household-budget-diagram",
  income: "household-budget-note-income",
  expenses: "household-budget-note-expenses",
  irregular: "household-budget-note-irregular",
  shareNote: "household-budget-note-shares",
  rounding: "household-budget-note-rounding",
  privacy: "household-budget-note-privacy",
} as const;

const CATEGORY_ICONS: Record<BudgetCategory, LucideIcon> = {
  housing: House,
  food: ShoppingBasket,
  transport: Car,
  utilities: Zap,
  health: HeartPulse,
  debtPayments: CreditCard,
  leisure: Ticket,
  other: Ellipsis,
};

export type HouseholdBudgetGuideContent = {
  /** Values for the example's paragraphs (`exampleBody`, `exampleShares`). */
  exampleValues: Record<string, string>;
  readTerms: GuideTerm[];
  flow: GuideFigure[];
  flowOperators: GuideFlowOperator[];
  shares: GuideFigure[];
  formulas: GuideFormulaLine[];
  notes: GuideTerm[];
};

export function buildHouseholdBudgetGuide(locale: Lang): HouseholdBudgetGuideContent {
  const t = getTranslations(locale);
  const tool = (key: string) => t(`tools.householdBudget.${key}`);
  const guide = (key: string) => t(`tools.householdBudget.guide.${key}`);
  const ids = HOUSEHOLD_BUDGET_GUIDE_IDS;

  const example = HOUSEHOLD_BUDGET_WORKED_EXAMPLE;
  const result = computeHouseholdBudget(example);
  const money = (value: number) => formatMoney(locale, value);
  const percent = (value: number | null) => (value === null ? "" : formatPercent(locale, value));
  const incomeOf = (id: string) => example.incomes.find((row) => row.id === id)?.amount ?? 0;
  const categoryOf = (category: BudgetCategory) =>
    result.categories.find((entry) => entry.category === category) ?? { total: 0, shareOfIncome: null };

  const exampleValues = {
    salary: money(incomeOf("salary")),
    other: money(incomeOf("other")),
    income: money(result.totalIncome),
    expenses: money(result.totalExpenses),
    surplus: money(result.balance),
    savingsRate: percent(result.savingsRate),
    housing: money(categoryOf("housing").total),
    housingShare: percent(categoryOf("housing").shareOfIncome),
    food: money(categoryOf("food").total),
    foodShare: percent(categoryOf("food").shareOfIncome),
    utilities: money(categoryOf("utilities").total),
  };

  const term = (key: string, id: string): GuideTerm => ({
    term: guide(`${key}Term`),
    body: guide(`${key}Body`),
    id,
  });

  const flow: GuideFigure[] = [
    { label: tool("totalIncome"), value: exampleValues.income, icon: Wallet },
    { label: tool("totalExpenses"), value: exampleValues.expenses, icon: Receipt },
    { label: tool("surplus"), value: exampleValues.surplus, icon: PiggyBank, tone: "positive" },
    {
      label: tool("savingsRate"),
      value: exampleValues.savingsRate,
      icon: Percent,
      detail: `${exampleValues.surplus} ÷ ${exampleValues.income}`,
    },
  ];

  // Largest category first, then the surplus, which completes the 100% of income.
  const shares: GuideFigure[] = [...result.categories]
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((entry) => ({
      label: tool(`categories.${entry.category}`),
      value: money(entry.total),
      icon: CATEGORY_ICONS[entry.category],
      share: entry.shareOfIncome,
      shareLabel: percent(entry.shareOfIncome),
    }));
  if (result.balance > 0) {
    shares.push({
      label: tool("surplus"),
      value: exampleValues.surplus,
      icon: PiggyBank,
      share: result.savingsRate,
      shareLabel: exampleValues.savingsRate,
      tone: "positive",
    });
  }

  const income = () => variable(tool("totalIncome"), ids.income);
  const hundred = number(formatNumber(locale, 100));
  const formulas: GuideFormulaLine[] = [
    {
      result: variable(tool("surplus"), ids.surplus),
      expression: [income(), operator("−"), variable(tool("totalExpenses"), ids.expenses)],
    },
    {
      result: variable(tool("savingsRate"), ids.shareNote),
      expression: [fraction([variable(tool("surplus"), ids.surplus)], [income()]), operator("×"), hundred],
    },
    {
      result: variable(guide("formulaCategoryShare"), ids.shareNote),
      expression: [
        fraction([variable(guide("formulaCategoryTotal"), ids.expenses)], [income()]),
        operator("×"),
        hundred,
      ],
    },
  ];

  return {
    exampleValues,
    readTerms: [
      term("readSurplus", ids.surplus),
      term("readDeficit", ids.deficit),
      term("readShares", ids.shares),
      term("readDiagram", ids.diagram),
    ],
    flow,
    flowOperators: ["−", "=", "→"],
    shares,
    formulas,
    notes: [
      term("methodIncome", ids.income),
      term("methodExpenses", ids.expenses),
      term("methodIrregular", ids.irregular),
      term("methodShares", ids.shareNote),
      term("methodRounding", ids.rounding),
      term("methodPrivacy", ids.privacy),
    ],
  };
}
