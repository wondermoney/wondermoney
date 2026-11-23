"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  MoveUpRight,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/Link";
import { useIsDemoProfile } from "@/lib/api/user/useProfile";
import { cn } from "@/lib/utils";
import { useDismissibleActivation } from "@/lib/utils/useDismissibleActivation";

interface SetupChecklistCardProps {
  hasAccount: boolean;
  hasReviewedTransactions: boolean;
  hasBudget: boolean;
  hasPortfolio: boolean;
}

const steps = [
  { key: "account", href: "/accounts" },
  { key: "transactions", href: "/accounts/transactions/review" },
  { key: "budget", href: "/budgets" },
  { key: "portfolio", href: "/portfolio" },
] as const;

const stepsListId = "activation-setup-steps";

export function SetupChecklistCard({
  hasAccount,
  hasReviewedTransactions,
  hasBudget,
  hasPortfolio,
}: SetupChecklistCardProps) {
  const t = useTranslations();
  const isDemo = useIsDemoProfile({ fetch: false });
  const [isExpanded, setIsExpanded] = useState(false);
  const { isDismissed, dismiss } = useDismissibleActivation("setup-checklist");
  const visibleSteps = steps;

  const completed = {
    account: hasAccount,
    transactions: hasReviewedTransactions,
    budget: hasBudget,
    portfolio: hasPortfolio,
  } as const;

  const completedStepsCount = visibleSteps.filter(
    (step) => completed[step.key],
  ).length;
  const totalStepsCount = visibleSteps.length;
  const remainingStepsCount = totalStepsCount - completedStepsCount;
  const allStepsComplete = visibleSteps.every((step) => completed[step.key]);

  if (isDemo || isDismissed || allStepsComplete) {
    return null;
  }

  const progressPercent =
    totalStepsCount > 0 ? (completedStepsCount / totalStepsCount) * 100 : 0;

  return (
    <section
      aria-label={t("activation-setup-progress-title")}
      className={cn(isExpanded && "border-border rounded-md border p-3")}
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 min-w-0 justify-start gap-2 px-2 text-sm"
          onClick={() => setIsExpanded((current) => !current)}
          aria-label={t(
            isExpanded
              ? "activation-setup-hide-steps"
              : "activation-setup-view-steps",
          )}
          aria-expanded={isExpanded}
          aria-controls={stepsListId}
        >
          <Circle
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <span>{t("activation-setup-hint")}</span>
          <span
            className="text-muted-foreground font-mono text-xs"
            aria-label={t("activation-setup-progress-count", {
              completed: completedStepsCount,
              total: totalStepsCount,
            })}
          >
            {completedStepsCount}/{totalStepsCount}
          </span>
          {isExpanded ? (
            <ChevronUp className="size-4 shrink-0" />
          ) : (
            <ChevronDown className="size-4 shrink-0" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={dismiss}
          aria-label={t("activation-hide-for-now")}
        >
          <X className="size-4" />
        </Button>
      </div>
      {isExpanded ? (
        <div className="mt-2 space-y-3 px-2">
          <p className="text-muted-foreground text-sm">
            {t("activation-setup-progress-nudge", {
              remaining: remainingStepsCount,
            })}
          </p>
          <div
            className="bg-muted h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={t("activation-setup-progress-title")}
            aria-valuemin={0}
            aria-valuemax={totalStepsCount}
            aria-valuenow={completedStepsCount}
          >
            <div
              className="bg-primary h-full w-full rounded-full"
              style={{ transform: `translateX(-${100 - progressPercent}%)` }}
            />
          </div>
        </div>
      ) : null}
      {isExpanded && (
        <ul
          id={stepsListId}
          className="border-border/70 mt-4 flex flex-col gap-1 border-t pt-3"
        >
          {visibleSteps.map((step) => {
            const isComplete = completed[step.key];

            return (
              <li key={step.key}>
                <Link
                  href={step.href}
                  className={cn(
                    "group hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring focus-visible:ring-offset-background active:bg-muted/70 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px",
                    isComplete ? "text-muted-foreground" : "text-foreground/90",
                  )}
                >
                  {isComplete ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="text-success-text size-4 shrink-0"
                    />
                  ) : (
                    <Circle
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                  )}
                  <span className={cn("min-w-0", !isComplete && "font-medium")}>
                    {t(`activation-step-${step.key}`)}
                  </span>
                  {!isComplete && (
                    <MoveUpRight
                      aria-hidden="true"
                      className="text-foreground/70 group-hover:text-foreground/90 group-focus-visible:text-foreground/90 size-4 shrink-0 transition-colors"
                    />
                  )}
                  <span className="sr-only">
                    {isComplete
                      ? t("activation-step-complete")
                      : t("activation-step-incomplete")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
