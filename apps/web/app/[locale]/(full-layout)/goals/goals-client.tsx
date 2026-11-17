"use client";

import { MoreHorizontal, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import DebtStrategySection from "@/components/goals/DebtStrategySection";
import GoalCard from "@/components/goals/GoalCard";
import GoalCreateDialog from "@/components/goals/GoalCreateDialog";
import GoalsEmptyState from "@/components/goals/GoalsEmptyState";
import GoalSummaryCards from "@/components/goals/GoalSummaryCards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CardGridSkeleton,
  StatCardsSkeleton,
} from "@/components/ui/PageSkeleton";
import { ToolbarAction } from "@/components/ui/ToolbarAction";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type { Goal } from "@/lib/api/goals/types";
import useGoals from "@/lib/api/goals/useGoals";
import useRestoreGoal from "@/lib/api/goals/useRestoreGoal";
import { goalsForView } from "@/lib/goals/view";

function ArchivedGoalCard({ goal }: { goal: Goal }) {
  const t = useTranslations();
  const mutation = useRestoreGoal(goal.goalKey);

  const restore = async () => {
    try {
      await mutation.mutateAsync();
      toast.success(t("goals.restore-success"));
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("goals.restore-error"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="opacity-60">
        <GoalCard goal={goal} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={restore}
        disabled={mutation.isPending}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        {t("goals.restore")}
      </Button>
    </div>
  );
}

export function GoalsClient() {
  const t = useTranslations();
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [showAchieved, setShowAchieved] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isError, isLoading } = useGoals({ includeArchived: true });

  const openCreateGoal = () => setCreateGoalOpen(true);

  if (isLoading) {
    // The shape of the page that is coming — summary cards then a card grid —
    // rather than a centred spinner that reflows everything when it lands.
    return (
      <div className="flex flex-col gap-6">
        <StatCardsSkeleton />
        <CardGridSkeleton count={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="text-muted-foreground p-6 text-sm">
        {t("server-error")}
      </Card>
    );
  }

  const allGoals = data?.goals ?? [];
  const activeGoals = goalsForView(allGoals, "active").filter(
    (goal) => goal.status !== "completed",
  );
  const goals = goalsForView(allGoals, "active").filter(
    (goal) => showAchieved || goal.status !== "completed",
  );
  const archivedGoals = goalsForView(allGoals, "archived");

  // With no goals yet, this header button and the one inside GoalsEmptyState
  // were the same label, icon and variant twice on one screen, 650px apart.
  // The empty state's copy explains what a goal is, so its button is the one
  // worth keeping; the header's earns its place once there is a list to act on.
  const showHeaderCreateGoal = allGoals.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <GoalCreateDialog isOpen={createGoalOpen} setOpen={setCreateGoalOpen} />

      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
            {t("goals.title")}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t("goals.subtitle")}
          </p>
        </div>
        {showHeaderCreateGoal ? (
          <ToolbarAction
            label={t("goals.create")}
            icon={<Plus className="size-4" aria-hidden="true" />}
            onClick={openCreateGoal}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-muted-foreground flex min-h-11 cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={showAchieved}
              onCheckedChange={(checked) => setShowAchieved(checked === true)}
            />
            {t("goals.show-achieved")}
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("goals.title")}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={showArchived}
                onCheckedChange={setShowArchived}
              >
                {t("goals.show-archived")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-col gap-6">
          {goals.length === 0 ? (
            allGoals.length === 0 ? (
              <GoalsEmptyState onCreateGoal={openCreateGoal} />
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("goals.no-active")}
              </p>
            )
          ) : (
            <>
              {activeGoals.length > 0 ? (
                <GoalSummaryCards goals={activeGoals} />
              ) : null}
              {/* A ruled ledger of goals, one per row, each drawn against
                  its own target. */}
              <ul className="border-foreground divide-border divide-y border-t-2">
                {goals.map((goal) => (
                  <li key={goal.goalKey}>
                    <GoalCard goal={goal} />
                  </li>
                ))}
              </ul>
              {activeGoals.length > 0 ? <DebtStrategySection /> : null}
            </>
          )}
        </div>

        {showArchived ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-foreground text-base font-medium">
              {t("goals.tab-archived")}
            </h2>
            {archivedGoals.length === 0 ? (
              <Card className="text-muted-foreground p-6 text-sm">
                {t("goals.archived-empty")}
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archivedGoals.map((goal) => (
                  <ArchivedGoalCard key={goal.goalKey} goal={goal} />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
