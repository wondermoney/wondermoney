import { createElement, type ReactElement } from "react";

import { MetricsPanel, StatusPanel } from "./components/LifecycleVisuals.js";
import type { LifecycleLanguage } from "./lifecycle-copy.js";

/**
 * Real per-user figures for the lifecycle campaigns whose visual can't be
 * static copy (net worth, spend, dates). All values are pre-formatted
 * display strings; this package stays presentation-only and never formats
 * currency or dates itself.
 */
export interface LifecycleDynamicData {
  netWorth?: string;
  accountCount?: string;
  transactionCount?: string;

  monthLabel?: string;
  netWorthChange?: string;
  netWorthChangeTone?: "positive" | "negative" | "neutral";
  totalSpent?: string;
  topCategory?: string;
  topCategoryAmount?: string;

  totalSaved?: string;
  savedThisPeriod?: string;
  periodLabel?: string;

  weekLabel?: string;
  spentThisWeek?: string;
  budgetRemaining?: string;

  previousHigh?: string;
  reachedOn?: string;

  /** Display name of the bank connection nearing expiry (data_health.consent_expiring). */
  bankName?: string;
  /** Formatted expiry date of the bank connection's authorization. */
  expiryDate?: string;
}

const DYNAMIC_VISUAL_COPY = {
  en: {
    firstSummary: "Your first summary",
    netWorthLabel: "Net worth",
    accountsLabel: "Accounts included",
    transactionsLabel: "Transactions organized",
    monthSummaryFallback: "This month's summary",
    monthSummary: (month: string) => `${month} summary`,
    changeLabel: "Change vs last month",
    totalSpentLabel: "Total spent",
    topCategoryLabel: (category: string) => `Top category · ${category}`,
    totalSavedLabel: "Total saved",
    savedDetail: (amount: string, period: string) =>
      `You saved ${amount} ${period}. Little by little, that's how a buffer gets built.`,
    weekBudgetLabel: "This week's budget",
    weekBudgetStatus: "All within plan",
    weekBudgetDetail: (spent: string, remaining: string) =>
      `You spent ${spent} and still have ${remaining} of headroom in your budget.`,
    netWorthMilestoneDetail: (previousHigh: string) =>
      `Previous high: ${previousHigh}. It's a good moment to see what contributed to this rise.`,
    connectionLabelFallback: "Bank connection",
    connectionLabelWithBank: (bankName: string) => `Connection to ${bankName}`,
    renewalNeededStatus: "Renewal needed",
    renewalNeededDetail: "Read-only access. Renewing lets you keep updating balances and transactions.",
    expiryMetadata: (expiryDate: string) => `Until ${expiryDate}`,
  },
  pt: {
    firstSummary: "O teu primeiro resumo",
    netWorthLabel: "Património",
    accountsLabel: "Contas incluídas",
    transactionsLabel: "Transações organizadas",
    monthSummaryFallback: "Resumo do mês",
    monthSummary: (month: string) => `Resumo de ${month}`,
    changeLabel: "Variação vs. mês anterior",
    totalSpentLabel: "Gasto total",
    topCategoryLabel: (category: string) => `Categoria de topo · ${category}`,
    totalSavedLabel: "Total poupado",
    savedDetail: (amount: string, period: string) =>
      `Poupaste ${amount} ${period}. Passo a passo, é assim que se constrói uma reserva.`,
    weekBudgetLabel: "Orçamento da semana",
    weekBudgetStatus: "Tudo dentro do plano",
    weekBudgetDetail: (spent: string, remaining: string) =>
      `Gastaste ${spent} e ainda tens ${remaining} de margem no orçamento.`,
    netWorthMilestoneDetail: (previousHigh: string) =>
      `Máximo anterior: ${previousHigh}. É um bom momento para veres o que contribuiu para esta subida.`,
    connectionLabelFallback: "Ligação bancária",
    connectionLabelWithBank: (bankName: string) => `Ligação a ${bankName}`,
    renewalNeededStatus: "Renovação necessária",
    renewalNeededDetail: "Acesso apenas de leitura. A renovação permite continuar a atualizar saldos e transações.",
    expiryMetadata: (expiryDate: string) => `Até ${expiryDate}`,
  },
} as const satisfies Record<LifecycleLanguage, Record<string, unknown>>;

/**
 * Builds the rich visual for campaigns whose content depends on real per-user
 * data. Returns undefined when the campaign+step has no dynamic visual (the
 * caller should fall back to the static steps/status/metrics visual, if any).
 */
export function buildDynamicVisual(
  campaign: string,
  step: string,
  language: LifecycleLanguage,
  data: LifecycleDynamicData | undefined,
): ReactElement | undefined {
  if (!data) return undefined;
  const t = DYNAMIC_VISUAL_COPY[language];
  const key = `${campaign}.${step}`;

  switch (key) {
    case "data_health.consent_expiring": {
      return createElement(StatusPanel, {
        label: data.bankName ? t.connectionLabelWithBank(data.bankName) : t.connectionLabelFallback,
        status: t.renewalNeededStatus,
        detail: t.renewalNeededDetail,
        metadata: data.expiryDate ? t.expiryMetadata(data.expiryDate) : undefined,
      });
    }

    default:
      return undefined;
  }
}
