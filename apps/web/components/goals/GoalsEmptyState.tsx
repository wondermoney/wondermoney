"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

// These were pre-formatted strings ("2,400") with no currency, so the preview
// showed bare numbers where the real product shows €2,400.00. Numbers now,
// formatted through the locale like every other figure in the app.
const sampleGoals = [
  {
    key: "emergency-fund",
    nameKey: "goals.empty-preview-emergency-fund",
    available: 2400,
    target: 6000,
    progress: 40,
  },
  {
    key: "vacation",
    nameKey: "goals.empty-preview-vacation",
    available: 850,
    target: 2000,
    progress: 43,
  },
  {
    key: "taxes",
    nameKey: "goals.empty-preview-taxes",
    available: 1200,
    target: 3000,
    progress: 40,
  },
];

export default function GoalsEmptyState({
  onCreateGoal,
}: {
  onCreateGoal: () => void;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  // The euro sign was glued on in front, so /pt read "€2.400,00" instead of
  // "2400,00 €". The locale decides where the symbol goes.
  const fmt = (value: number) => formatCurrency(value, "EUR");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="space-y-2">
        {/* An <h2>, not an <h1>: the goals page already renders an <h1>
            ("Goals") in its own header, so this was the page's second
            top-level heading. */}
        <h2 className="text-foreground text-2xl font-semibold tracking-tight">
          {t("goals.empty-title")}
        </h2>
        <p className="text-muted-foreground text-sm leading-6">
          {t("goals.empty-description")}
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-foreground text-sm font-medium">
            {t("goals.title")}
          </h3>
          <PreviewBadge />
        </div>

        <div className="space-y-4">
          {sampleGoals.map((goal) => (
            <div key={goal.key} className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {t(goal.nameKey)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("goals.available")} / {t("goals.target")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-foreground font-mono text-sm whitespace-nowrap tabular-nums">
                    {fmt(goal.available)}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs whitespace-nowrap tabular-nums">
                    {fmt(goal.target)}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div
                  className="bg-muted h-2 overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${goal.progress}%` }}
                  />
                </div>
                {/* The right-hand span repeated both figures printed 20px
                    above it, so every row showed its numbers twice. */}
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span className="font-mono tabular-nums">
                    {goal.progress}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground mt-4 text-xs leading-5">
          {t("goals.budget-explainer")}
        </p>
      </div>

      <Button className="w-fit gap-2" onClick={onCreateGoal}>
        <Plus className="size-4" aria-hidden="true" />
        {t("goals.create")}
      </Button>
    </div>
  );
}
