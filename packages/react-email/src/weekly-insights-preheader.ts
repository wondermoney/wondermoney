import type { TransactionalEmailLanguage, WeeklyBudgetSummary } from "./types.js";

export const COPY = {
  en: {
    withBudget: "Spending, top category and budget status for the completed week.",
    withoutBudget: "Spending and top category for the completed week.",
  },
  pt: {
    withBudget: "Gastos, categoria principal e estado dos orçamentos da semana completa.",
    withoutBudget: "Gastos e categoria principal da semana completa.",
  },
  es: {
    withBudget: "Gastos, categoría principal y estado de los presupuestos de la semana completa.",
    withoutBudget: "Gastos y categoría principal de la semana completa.",
  },
} as const satisfies Record<TransactionalEmailLanguage, Record<string, string>>;

export function getWeeklyInsightsPreheader(
  budgetSummary: WeeklyBudgetSummary | undefined,
  language: TransactionalEmailLanguage = "pt",
): string {
  return budgetSummary ? COPY[language].withBudget : COPY[language].withoutBudget;
}
