"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Check,
  CircleDollarSign,
  Compass,
  LineChart,
  PiggyBank,
  WalletCards,
} from "lucide-react";

import {
  FIRST_RUN_GOALS,
  FIRST_RUN_MAX_GOALS,
  type FirstRunGoal,
} from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";

import FirstRunIconTile, { type FirstRunIconTone } from "./FirstRunIconTile";

type FirstRunGoalSelectorProps = {
  selectedGoals: FirstRunGoal[];
  getLabel: (goal: FirstRunGoal) => string;
  getHelper?: (goal: FirstRunGoal) => string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  onChange: (goals: FirstRunGoal[]) => void;
};

const goalIcons: Record<FirstRunGoal, LucideIcon> = {
  all_in_one: WalletCards,
  spending: BarChart3,
  budget: PiggyBank,
  investments_net_worth: LineChart,
  financial_freedom: CircleDollarSign,
  exploring: Compass,
};

const goalTones: Record<FirstRunGoal, FirstRunIconTone> = {
  all_in_one: "violet",
  spending: "sky",
  budget: "sky",
  investments_net_worth: "violet",
  financial_freedom: "green",
  exploring: "slate",
};

export default function FirstRunGoalSelector({
  selectedGoals,
  getLabel,
  getHelper,
  ariaLabel,
  ariaDescribedBy,
  onChange,
}: FirstRunGoalSelectorProps) {
  const toggleGoal = (goal: FirstRunGoal) => {
    const next = selectedGoals.includes(goal)
      ? selectedGoals.filter((item) => item !== goal)
      : [...selectedGoals, goal];
    onChange(next.slice(0, FIRST_RUN_MAX_GOALS));
  };

  return (
    <div
      className="space-y-2"
      role="group"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
    >
      {FIRST_RUN_GOALS.map((goal) => {
        const selected = selectedGoals.includes(goal);
        const disabled =
          !selected && selectedGoals.length >= FIRST_RUN_MAX_GOALS;
        const helper = getHelper?.(goal);

        return (
          <button
            key={goal}
            type="button"
            role="checkbox"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => toggleGoal(goal)}
            className={cn(
              "border-border bg-card text-foreground group flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
              "hover:border-border/80 hover:bg-muted/40",
              selected && "border-primary bg-primary/[0.06]",
              disabled && "hover:bg-card cursor-not-allowed opacity-50",
            )}
          >
            <FirstRunIconTile icon={goalIcons[goal]} tone={goalTones[goal]} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-foreground text-sm leading-5 font-medium">
                {getLabel(goal)}
              </span>
              {helper ? (
                <span className="text-muted-foreground text-[13px] leading-5">
                  {helper}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "border-border flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-transparent",
              )}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
