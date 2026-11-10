"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Text from "@/components/ui/Typography/Text";
import useBudgetSuggestions, {
  type BudgetSuggestionMonths,
} from "@/lib/api/budget/useBudgetSuggestions";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

/** The parts of a budget table row a suggestion needs: its key, amount and children. */
type SuggestionRow = {
  budgeted: number;
  key: number;
  subRows?: SuggestionRow[];
};

type Props = {
  budgetKey: number;
  currency: SupportedCurrencyCodes;
  month: number;
  months?: BudgetSuggestionMonths;
  onApply: (updates: { amount: number; categoryKey: number }[]) => Promise<void> | void;
  rows: SuggestionRow[];
  year: number;
};

/** Leaf rows the table shows, keyed by category key, with their current monthly amount. */
function currentAmounts(rows: SuggestionRow[]): Map<number, number> {
  const amounts = new Map<number, number>();
  const walk = (nextRows: SuggestionRow[]) => {
    for (const row of nextRows) {
      if (row.subRows && row.subRows.length > 0) {
        walk(row.subRows);
        continue;
      }
      amounts.set(row.key, row.budgeted);
    }
  };
  walk(rows);
  return amounts;
}

/**
 * "Suggest from my spending": each category's median complete-month spending, rounded up to five,
 * beside the amount it would replace, with Apply per category and Apply all.
 */
export function BudgetSuggestionsCard({
  budgetKey,
  currency,
  month,
  months = 3,
  onApply,
  rows,
  year,
}: Props) {
  const t = useTranslations();
  const [applying, setApplying] = useState(false);
  const { data, isLoading } = useBudgetSuggestions(
    { budgetKey, month, months, year },
    { staleTime: 60_000 },
  );
  const amounts = useMemo(() => currentAmounts(rows), [rows]);
  const suggestions = data?.categories ?? [];
  const applicable = suggestions.filter(
    (suggestion) => suggestion.hasEnoughData && suggestion.suggested !== null,
  );

  const apply = async (updates: { amount: number; categoryKey: number }[]) => {
    if (updates.length === 0) return;
    setApplying(true);
    try {
      await onApply(updates);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("budget-suggestions-title")}</CardTitle>
        <Text variant="mutedText">
          {t("budget-suggestions-description", { months })}
        </Text>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Text variant="mutedText">{t("loading")}</Text>
        ) : suggestions.length === 0 ? (
          <Text variant="mutedText">{t("budget-suggestions-empty")}</Text>
        ) : (
          <>
            <div className="space-y-2">
              {suggestions.map((suggestion) => {
                const current = amounts.get(suggestion.categoryKey);
                const canApply =
                  suggestion.hasEnoughData && suggestion.suggested !== null;
                return (
                  <div
                    key={suggestion.categoryKey}
                    className="bg-muted/40 flex flex-col gap-2 rounded-md px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium">{suggestion.categoryName}</span>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {t("budget-suggestions-current")}:{" "}
                        {current === undefined ? (
                          "—"
                        ) : (
                          <Amount value={current} currency={currency} />
                        )}
                      </span>
                      {canApply ? (
                        <>
                          <span className="font-mono font-medium">
                            {t("budget-suggestions-suggested")}:{" "}
                            <Amount
                              value={suggestion.suggested!}
                              currency={currency}
                            />
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={applying}
                            onClick={() =>
                              void apply([
                                {
                                  amount: suggestion.suggested!,
                                  categoryKey: suggestion.categoryKey,
                                },
                              ])
                            }
                          >
                            {t("budget-suggestions-apply")}
                          </Button>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("budget-suggestions-not-enough-data")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {applicable.length > 0 && (
              <Button
                type="button"
                disabled={applying}
                loading={applying}
                onClick={() =>
                  void apply(
                    applicable.map((suggestion) => ({
                      amount: suggestion.suggested!,
                      categoryKey: suggestion.categoryKey,
                    })),
                  )
                }
              >
                {t("budget-suggestions-apply-all")}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
