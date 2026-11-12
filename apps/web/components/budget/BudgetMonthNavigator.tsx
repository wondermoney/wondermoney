"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/Typography";

interface BudgetMonthNavigatorProps {
  label: string | null;
  /** The days the month covers, under its name; absent for a calendar month. */
  periodLabel?: string | null;
  hasPreviousMonth: boolean;
  hasNextMonth: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

const arrowButtonClass =
  "text-primary bg-primary/5 hover:bg-primary/10 hover:text-primary size-11 rounded-full md:size-8";

/**
 * The month heading on a budget, between its previous/next arrows. The arrows
 * are real buttons, not bare SVGs with click handlers: they need an accessible
 * name, keyboard reachability, and a real disabled state rather than opacity.
 */
export function BudgetMonthNavigator({
  label,
  periodLabel,
  hasPreviousMonth,
  hasNextMonth,
  onPreviousMonth,
  onNextMonth,
}: BudgetMonthNavigatorProps) {
  const t = useTranslations();

  return (
    <div className="flex flex-row items-center gap-2 p-4 pl-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("previous-month")}
        disabled={!hasPreviousMonth}
        onClick={onPreviousMonth}
        className={arrowButtonClass}
      >
        <ArrowLeft className="size-6" aria-hidden="true" />
      </Button>
      <div className="flex flex-col">
        <Heading
          variant="h4"
          as="h2"
          className="text-xl font-semibold lg:text-2xl"
        >
          {label}
        </Heading>
        {periodLabel ? (
          <p className="text-muted-foreground text-sm">{periodLabel}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("next-month")}
        disabled={!hasNextMonth}
        onClick={onNextMonth}
        className={arrowButtonClass}
      >
        <ArrowRight className="size-6" aria-hidden="true" />
      </Button>
    </div>
  );
}
