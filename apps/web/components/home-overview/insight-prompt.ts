"use client";

import { useTranslations } from "next-intl";

import type { Insight } from "@/lib/api/insights/useInsights";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

/**
 * The question "Ask the assistant" pre-fills for an insight, in the reader's
 * locale and from the same facts the card shows — so the assistant starts from
 * what changed rather than from a generic prompt.
 *
 * The budget figures are left out while privacy mode is on: the question sits
 * in a text field on screen, and a masked amount would be sent as text.
 */
export function useInsightPrompt(insight: Insight): string {
  const t = useTranslations("homeOverview.insights.ask.prompt");
  const formatPercent = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const { hidden } = usePrivacyMode();

  if (insight.type === "spending_vs_normal") {
    const facts = insight.facts;
    const percent = formatPercent(
      Math.abs(Number(facts.deviationPercent)) / 100,
    );

    return t(`spending.${facts.direction}`, {
      category: facts.categoryName,
      percent,
    });
  }

  const facts = insight.facts;
  const category = facts.parentCategoryName
    ? `${facts.parentCategoryName} / ${facts.categoryName}`
    : facts.categoryName;

  if (hidden) {
    return t("budgetHidden", { category });
  }

  return t("budget", {
    budgeted: formatCurrency(Number(facts.amountBudgeted), facts.currencyCode),
    category,
    projected: formatCurrency(
      Number(facts.projectedAmount),
      facts.currencyCode,
    ),
  });
}
