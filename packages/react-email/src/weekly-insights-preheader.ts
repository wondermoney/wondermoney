import type { TransactionalEmailLanguage, WeeklyBudgetSummary } from "./types.js";

const COPY = {
  en: {
    withBudget: "Spending, top category and budget status for the completed week.",
    withoutBudget: "Spending and top category for the completed week.",
  },
  pt: {
    withBudget: "Gastos, categoria principal e estado dos orçamentos da semana completa.",
    withoutBudget: "Gastos e categoria principal da semana completa.",
  },
} as const satisfies Record<TransactionalEmailLanguage, Record<string, string>>;

export function getWeeklyInsightsPreheader(
  budgetSummary: WeeklyBudgetSummary | undefined,
  language: TransactionalEmailLanguage = "pt",
): string {
  return budgetSummary ? COPY[language].withBudget : COPY[language].withoutBudget;
}
