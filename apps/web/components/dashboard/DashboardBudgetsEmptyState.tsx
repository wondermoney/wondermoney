"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { HelpHint } from "@/components/ui/help-hint";
import { Link } from "@/components/ui/Link";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { Text } from "@/components/ui/Typography";
import { getDocsLink } from "@/lib/docs-links";
import { cn } from "@/lib/utils";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

// No colour on the rows. This block previews the real budgets table, and there
// the bar encodes *headroom* — primary under budget, destructive over — not
// which category the row happens to be. Colouring by category made a
// 71%-consumed budget render orange, which reads as a warning it isn't. The
// six raw hexes this replaced also tracked neither theme (slop-test gate 48).
const sampleBudgets = [
  { name: "Food & Drinks", icon: "cooking-pot", spent: 320, budget: 450 },
  { name: "Rent & Utilities", icon: "house", spent: 1180, budget: 1500 },
  { name: "Transportation", icon: "navigation", spent: 85, budget: 150 },
];

const totalSpent = sampleBudgets.reduce((sum, budget) => sum + budget.spent, 0);
const totalBudget = sampleBudgets.reduce(
  (sum, budget) => sum + budget.budget,
  0,
);

const diagonalPatternStyle = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0, transparent 10px, color-mix(in oklch, var(--border) 78%, transparent) 10px, color-mix(in oklch, var(--border) 78%, transparent) 11px)",
};

function DashboardBudgetsEmptyState() {
  const locale = useLocale();
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  // Lives inside the component because it needs the active locale,
  // which only a hook can reach.
  const formatPreviewCurrency = (value: number) =>
    formatCurrency(value, "EUR", {
      notation: "standard",
      maximumFractionDigits: 0,
    });
  const envelopeDocsHref = getDocsLink("envelopeMethod", locale);

  return (
    <Card className="border-border/70 bg-card shadow-none">
      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,360px)] lg:items-start lg:p-5">
        <div className="border-border/70 bg-card/70 relative overflow-hidden rounded-lg border p-4 pt-8 shadow-xs">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-90"
            style={diagonalPatternStyle}
          />
          {/* This one keeps a corner-anchored placement (rounded-bl instead of
              rounded-md, absolute instead of inline) since it sits on a
              standalone card rather than in a header row next to a title —
              a positioning difference, not a restyled badge. */}
          <PreviewBadge className="absolute top-0 right-0 z-10 rounded-none rounded-bl-md border-t-0 border-r-0" />

          <div className="relative space-y-3">
            {sampleBudgets.map((budget) => {
              const progress = Math.min(
                (budget.spent / budget.budget) * 100,
                100,
              );
              const isOverBudget = budget.spent > budget.budget;

              return (
                <div key={budget.name} className="space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                        <CategoryIcon
                          icon={budget.icon}
                          width="14px"
                          height="14px"
                          className="text-muted-foreground"
                        />
                      </div>
                      <Text
                        variant="smallText"
                        className="min-w-0 truncate font-medium"
                      >
                        {t(getCategoryTranslationKey(budget.name))}
                      </Text>
                    </div>

                    <Text
                      variant="smallText"
                      className="shrink-0 font-mono text-sm font-medium whitespace-nowrap"
                    >
                      {formatPreviewCurrency(budget.spent)}{" "}
                      <span className="text-muted-foreground">
                        / {formatPreviewCurrency(budget.budget)}
                      </span>
                    </Text>
                  </div>

                  <div
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className={cn(
                        "h-1.5 rounded-full",
                        isOverBudget ? "bg-destructive" : "bg-primary",
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="border-border/70 flex items-center justify-between gap-4 border-t pt-3">
              <Text variant="smallText" className="font-medium">
                {t("total")}
              </Text>
              <Text
                variant="smallText"
                className="shrink-0 font-mono text-sm font-semibold whitespace-nowrap"
              >
                {formatPreviewCurrency(totalSpent)}{" "}
                <span className="text-muted-foreground font-medium">
                  / {formatPreviewCurrency(totalBudget)}
                </span>
              </Text>
            </div>
          </div>
        </div>

        <div className="border-border/70 bg-muted/20 h-full space-y-4 rounded-lg border p-4">
          <div className="space-y-2">
            {/* This renders inside the budgets section, under its
                SectionHeader h2, so the level is h3. Not `variant="h6"`: that
                maps straight to an <h6> tag and skips three levels; the size is
                kept as utility classes, which is how the sibling dashboard
                cards write their headings. */}
            <h3 className="text-foreground scroll-m-20 text-base font-semibold tracking-tight">
              {t("budget-empty-state-title")}
            </h3>
            <Text variant="mutedText">
              {t("budget-empty-state-description")}
            </Text>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="gap-2">
              <Link
                href="/budgets/wizard"
                className={cn(buttonVariants({ variant: "default" }))}
              >
                <Plus className="size-4" />
                {t("create-first-budget")}
              </Link>
            </Button>

            <HelpHint href={envelopeDocsHref}>
              {t("help-hint-budgets")}
            </HelpHint>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default DashboardBudgetsEmptyState;
