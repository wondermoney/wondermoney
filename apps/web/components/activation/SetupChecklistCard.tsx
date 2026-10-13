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
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { RETENTION_GROWTH_EVENTS } from "@/lib/utils/analytics";
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
  const posthog = usePostHog();
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

  useEffect(() => {
    if (isDismissed || allStepsComplete) return;

    posthog?.capture(RETENTION_GROWTH_EVENTS.profileCompletenessViewed, {
      completedStepsCount,
      totalStepsCount,
      hasAccount,
      hasReviewedTransactions,
      hasBudget,
      hasPortfolio,
    });
  }, [
    allStepsComplete,
    completedStepsCount,
    hasAccount,
    hasBudget,
    hasPortfolio,
    hasReviewedTransactions,
    isDismissed,
    posthog,
    totalStepsCount,
  ]);

  if (isDismissed || allStepsComplete) {
    return null;
  }

  const firstIncompleteStep =
    visibleSteps.find((step) => !completed[step.key]) ?? visibleSteps[0];
  const progressPercent =
    totalStepsCount > 0 ? (completedStepsCount / totalStepsCount) * 100 : 0;

  return (
    <Card className="border-border/70 bg-card">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-sm font-medium">
                {t("activation-setup-progress-title")}
              </p>
              <p className="text-muted-foreground text-sm leading-5">
                {t("activation-setup-progress-count", {
                  completed: completedStepsCount,
                  total: totalStepsCount,
                })}
              </p>
              <p className="text-muted-foreground text-sm leading-5">
                {t("activation-setup-progress-nudge", {
                  remaining: remainingStepsCount,
                })}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-8"
                onClick={() => setIsExpanded((current) => !current)}
                aria-label={
                  isExpanded
                    ? t("activation-setup-hide-steps")
                    : t("activation-setup-view-steps")
                }
                aria-expanded={isExpanded}
                aria-controls={stepsListId}
              >
                {isExpanded ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={dismiss}
                aria-label={t("activation-hide-for-now")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div
            className="bg-muted h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={t("activation-setup-progress-title")}
            aria-valuemin={0}
            aria-valuemax={totalStepsCount}
            aria-valuenow={completedStepsCount}
          >
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

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
                    onClick={() => {
                      posthog?.capture(
                        RETENTION_GROWTH_EVENTS.profileCompletenessItemClicked,
                        {
                          itemKey: step.key,
                          isComplete,
                          completedStepsCount,
                          totalStepsCount,
                        },
                      );
                    }}
                    className={cn(
                      "group hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring focus-visible:ring-offset-background active:bg-muted/70 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px",
                      isComplete
                        ? "text-muted-foreground"
                        : "text-foreground/90",
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
                    <span
                      className={cn("min-w-0", !isComplete && "font-medium")}
                    >
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
      </CardContent>
    </Card>
  );
}
