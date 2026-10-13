"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import CategoryIcon from "@/components/ui/CategoryIcon";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { Text } from "@/components/ui/Typography";
import { getCategoryTranslationKey } from "@/lib/utils/categories";

import { Button } from "../ui/button";

interface BudgetsEmptyStateProps {
  onCreateBudget: () => void;
}

// These were six raw Tailwind pastels (#fed7aa/#ea580c, #99f6e4/#0d9488,
// #ddd6fe/#7c3aed) that tracked neither half of the theme. On the dark canvas
// the chip stayed a pale peach while the glyph inherited the near-white
// foreground, so the three category icons measured 1.30, 1.21 and 1.33 to 1 —
// invisible. These are sample rows, not API categories, so they can use the
// system's own ramp: the chart slots are the categorical-identity job, they
// hold their hue across both halves, and the chip is the same colour at low
// alpha so the glyph always sits on its own tint.
const sampleCategories = [
  {
    name: "HOUSING",
    icon: "house",
    spent: 1200,
    budget: 1500,
    color: "var(--chart-1)",
  },
  {
    name: "FOOD",
    icon: "cooking-pot",
    spent: 320,
    budget: 400,
    color: "var(--chart-2)",
  },
  {
    name: "TRANSPORTATION",
    icon: "navigation",
    spent: 85,
    budget: 150,
    color: "var(--chart-3)",
  },
];

const BudgetsEmptyState: React.FC<BudgetsEmptyStateProps> = ({
  onCreateBudget,
}) => {
  const t = useTranslations();
  const locale = useLocale();

  // The sample figures were interpolated raw (`€{category.spent}`), so the
  // preview showed `€1200 / €1500` while every real balance in the product
  // renders `€1,200.00`. Match the product.
  const fmt = (value: number) =>
    `€${value.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t("activation-budget-envelope-title")}
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("activation-budget-envelope-description")}
        </p>
      </div>

      {/* Primary CTA — above the preview, matching the accounts and portfolio
          empty states, so the action is reachable without reading past a
          sample table. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="gap-2" onClick={onCreateBudget}>
          <Plus className="size-4" />
          {t("create-first-budget")}
        </Button>
      </div>

      {/* Preview */}
      <div className="border-border bg-card rounded-lg border">
        <div className="border-border flex items-center justify-between border-b px-6 py-3">
          <span className="text-foreground text-sm font-medium">
            {t("budgets")}
          </span>
          <PreviewBadge />
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {sampleCategories.map((category, index) => {
              const progressPercentage =
                (category.spent / category.budget) * 100;
              return (
                <div key={index} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-full"
                        style={{
                          // 12%, not 18%: the glyph is the same colour as its
                          // chip, so a heavier tint eats the glyph. At 18% the
                          // amber slot measured 2.92:1, under the 3:1
                          // non-text floor; at 12% the worst slot is 3.13:1
                          // light and 4.96:1 dark.
                          backgroundColor: `color-mix(in oklch, ${category.color} 12%, transparent)`,
                          color: category.color,
                        }}
                      >
                        {/* CategoryIcon hardcodes `text-foreground`, which is
                            what made these glyphs vanish on the dark canvas;
                            `text-current` hands the colour back to the chip. */}
                        <CategoryIcon
                          icon={category.icon}
                          width="12px"
                          height="12px"
                          className="text-current"
                        />
                      </div>
                      <Text className="text-foreground text-sm">
                        {t(getCategoryTranslationKey(category.name))}
                      </Text>
                    </div>
                    <Text className="text-muted-foreground font-mono text-sm font-medium whitespace-nowrap tabular-nums">
                      {fmt(category.spent)}{" "}
                      <span className="text-muted-foreground/60 text-xs">
                        / {fmt(category.budget)}
                      </span>
                    </Text>
                  </div>
                  <div className="bg-muted h-1.5 rounded-full">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(progressPercentage, 100)}%`,
                        backgroundColor: category.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="border-border border-t pt-3">
              <div className="flex justify-between">
                <Text className="text-foreground text-sm font-medium">
                  {t("total")}
                </Text>
                <Text className="text-foreground font-mono text-sm font-semibold whitespace-nowrap tabular-nums">
                  {fmt(
                    sampleCategories.reduce((sum, cat) => sum + cat.spent, 0),
                  )}{" "}
                  <span className="text-muted-foreground font-normal">
                    /{" "}
                    {fmt(
                      sampleCategories.reduce(
                        (sum, cat) => sum + cat.budget,
                        0,
                      ),
                    )}
                  </span>
                </Text>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetsEmptyState;
