"use client";

import { useTranslations } from "next-intl";

import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import { Amount } from "@/components/ui/Amount";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { Section } from "@/components/ui/RuledSection";
import { Spinner } from "@/components/ui/Spinner";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import useTransactionsCategorySpending from "@/lib/api/account/useTransactionsCategorySpending";
import { useMemberFilter } from "@/lib/household/useMemberFilter";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { resolveCategoryColor } from "@/lib/utils/categoryColor";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface AccountsCategorySpendingProps {
  fromDate?: Date;
  toDate?: Date;
  userCurrency: string;
}

/**
 * The accounts overview's spending by category for the period: the six biggest top-level
 * categories, each with its share of their total.
 *
 * It follows the member filter (`?member=`, `lib/household/member-attribution.ts`), whose control
 * sits in the section's head because the rest of the overview (balances, cash flow, the latest
 * transactions) stays the household's. The control, and the filter, are absent in a household of
 * one.
 */
export default function AccountsCategorySpending({
  fromDate,
  toDate,
  userCurrency,
}: AccountsCategorySpendingProps) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const { memberKeys } = useMemberFilter();

  const { data: categorySpendingData, isLoading: isLoadingCategorySpending } =
    useTransactionsCategorySpending({
      fromDate,
      toDate,
      limit: 6,
      ...(memberKeys ? { memberKeys } : {}),
    });

  const categories = categorySpendingData?.categorySpending ?? [];
  const totalSpending = categories.reduce(
    (sum, category) => sum + Math.abs(category.amount),
    0,
  );

  return (
    <Section
      id="spending-heading"
      title={t("spending-by-category")}
      aside={<MemberFilterControl className="w-40 sm:w-44" />}
    >
      <div>
        {isLoadingCategorySpending ? (
          <div className="flex h-30 items-center justify-center">
            <Spinner />
          </div>
        ) : categories.length > 0 ? (
          <div className="divide-border divide-y">
            {categories.map((cat, catIndex) => {
              const pct =
                totalSpending > 0
                  ? (Math.abs(cat.amount) / totalSpending) * 100
                  : 0;

              return (
                <div
                  key={cat.categoryKey}
                  className="flex items-center gap-3 py-3 first:pt-0"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${resolveCategoryColor(cat.bgColor, catIndex)} 15%, transparent)`,
                      // The API's category colours are pastels: painted
                      // straight onto their own 15% tint they measured well
                      // under 3:1 on the light canvas. Mixing toward the
                      // foreground keeps the hue and clears 3:1 in both themes.
                      color: `color-mix(in oklch, ${resolveCategoryColor(cat.bgColor, catIndex)} 45%, var(--foreground))`,
                    }}
                  >
                    <CategoryIcon
                      icon={cat.icon}
                      category={!cat.icon ? cat.name : undefined}
                      width="16px"
                      height="16px"
                      className="text-current"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground truncate text-sm">
                        {t(getCategoryTranslationKey(cat.name))}
                      </span>
                      <span className="text-foreground shrink-0 font-mono text-sm font-medium">
                        <Amount
                          value={Math.abs(cat.amount)}
                          currency={cat.currency ?? userCurrency}
                        />
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: resolveCategoryColor(
                              cat.bgColor,
                              catIndex,
                            ),
                          }}
                        />
                      </div>
                      <span className="text-muted-foreground w-10 text-right font-mono text-xs">
                        {formatPercentage(pct / 100)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-30 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              {t("empty-category-spending-description")}
            </p>
          </div>
        )}
        {!isLoadingCategorySpending && (
          <UnconvertedAmountsNotice
            completeness={categorySpendingData?.completeness}
            className="pt-3"
          />
        )}
      </div>
    </Section>
  );
}
