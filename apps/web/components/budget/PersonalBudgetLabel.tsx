"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  type BudgetVisibility,
  isPersonalBudget,
} from "@/lib/budget/visibility";
import { cn } from "@/lib/utils";

/**
 * "Personal" beside a budget only its creator can see; nothing for a
 * household budget, which is the ordinary case. `inline` sits beside a name in
 * a list (the private-asset label's shape), `badge` beside a page title.
 */
export function PersonalBudgetLabel({
  budget,
  variant = "inline",
  className,
}: {
  budget: { visibility?: BudgetVisibility };
  variant?: "inline" | "badge";
  className?: string;
}) {
  const t = useTranslations("budgetVisibility");
  if (!isPersonalBudget(budget)) return null;

  if (variant === "badge") {
    return (
      <Badge variant="muted" title={t("personal-hint")} className={className}>
        {t("personal")}
      </Badge>
    );
  }

  return (
    <span
      title={t("personal-hint")}
      className={cn(
        "text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs font-normal",
        className,
      )}
    >
      <Lock className="size-3" aria-hidden="true" />
      {t("personal")}
    </span>
  );
}
