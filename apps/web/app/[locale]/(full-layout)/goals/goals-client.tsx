"use client";

import { Plus, RotateCcw } from "lucide-react";
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
import {
  CardGridSkeleton,
  StatCardsSkeleton,
} from "@/components/ui/PageSkeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type { Goal } from "@/lib/api/goals/types";
import useGoals from "@/lib/api/goals/useGoals";
import useRestoreGoal from "@/lib/api/goals/useRestoreGoal";

type GoalsView = "active" | "archived";

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
  const [view, setView] = useState<GoalsView>("active");
  const { data, isError, isLoading } = useGoals(
    view === "archived" ? { includeArchived: true } : undefined,
  );

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
  const goals =
    view === "archived"
      ? allGoals.filter((goal) => goal.status === "archived")
      : allGoals;

  // With no goals yet, this header button and the one inside GoalsEmptyState
  // were the same label, icon and variant twice on one screen, 650px apart.
  // The empty state's copy explains what a goal is, so its button is the one
  // worth keeping; the header's earns its place once there is a list to act on.
  const showHeaderCreateGoal = !(view === "active" && allGoals.length === 0);

  return (
    <div className="flex flex-col gap-6">
      <GoalCreateDialog isOpen={createGoalOpen} setOpen={setCreateGoalOpen} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            {t("goals.title")}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t("goals.subtitle")}
          </p>
        </div>
        {showHeaderCreateGoal ? (
          <Button className="inline-flex w-fit gap-2" onClick={openCreateGoal}>
            <Plus className="size-4" aria-hidden="true" />
            {t("goals.create")}
          </Button>
        ) : null}
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as GoalsView)}>
        <TabsList>
          <TabsTrigger value="active">{t("goals.tab-active")}</TabsTrigger>
          <TabsTrigger value="archived">{t("goals.tab-archived")}</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="flex flex-col gap-6">
          {goals.length === 0 ? (
            <GoalsEmptyState onCreateGoal={openCreateGoal} />
          ) : (
            <>
              <GoalSummaryCards goals={goals} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {goals.map((goal) => (
                  <GoalCard key={goal.goalKey} goal={goal} />
                ))}
              </div>
              <DebtStrategySection />
            </>
          )}
        </TabsContent>

        <TabsContent value="archived" className="flex flex-col gap-6">
          {goals.length === 0 ? (
            <Card className="text-muted-foreground p-6 text-sm">
              {t("goals.archived-empty")}
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {goals.map((goal) => (
                <ArchivedGoalCard key={goal.goalKey} goal={goal} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
