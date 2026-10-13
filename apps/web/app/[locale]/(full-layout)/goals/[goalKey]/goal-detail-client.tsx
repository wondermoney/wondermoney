"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import ArchiveGoalDialog from "@/components/goals/ArchiveGoalDialog";
import AssignMoneyDialog from "@/components/goals/AssignMoneyDialog";
import GoalEditDialog from "@/components/goals/GoalEditDialog";
import MoveGoalMoneyDialog from "@/components/goals/MoveGoalMoneyDialog";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/Spinner";
import useGoal from "@/lib/api/goals/useGoal";
import useGoalActivity from "@/lib/api/goals/useGoalActivity";

import DebtPayoffPanel from "./DebtPayoffPanel";
import GoalAccountContext from "./GoalAccountContext";
import GoalActivityList from "./GoalActivityList";
import GoalDetailHeader from "./GoalDetailHeader";
import GoalFundingPanel from "./GoalFundingPanel";

export default function GoalDetailClient({ goalKey }: { goalKey: number }) {
  const t = useTranslations();
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const goalQuery = useGoal(goalKey);
  const activityQuery = useGoalActivity(goalKey);

  if (!Number.isInteger(goalKey) || goalKey <= 0) {
    return (
      <Card className="text-muted-foreground p-6 text-sm">
        {t("invalid-entity")}
      </Card>
    );
  }

  if (goalQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (goalQuery.isError || !goalQuery.data) {
    return (
      <Card className="text-muted-foreground p-6 text-sm">
        {t("server-error")}
      </Card>
    );
  }

  const { goal, summary } = goalQuery.data;
  const currencyCode =
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" ? goal.currencyKey.code : undefined);
  const isDebt = goal.type === "debt_paydown";

  return (
    <div className="space-y-6">
      <GoalDetailHeader
        goal={goal}
        summary={summary}
        onArchive={() => setArchiveOpen(true)}
        onAssignMoney={() => setAssignOpen(true)}
        onEdit={() => setEditOpen(true)}
        onMoveMoneyOut={() => setMoveOpen(true)}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          {isDebt ? (
            <DebtPayoffPanel
              currencyCode={currencyCode}
              goal={goal}
              summary={summary}
            />
          ) : (
            <GoalFundingPanel goal={goal} summary={summary} />
          )}
          <GoalActivityList
            activityQuery={activityQuery}
            currencyCode={currencyCode}
          />
        </div>
        <GoalAccountContext goal={goal} />
      </div>
      <AssignMoneyDialog
        currencyCode={currencyCode}
        goalKey={goalKey}
        isOpen={assignOpen}
        onOpenChange={setAssignOpen}
      />
      <MoveGoalMoneyDialog
        availableAmount={summary.availableAmount}
        currencyCode={currencyCode}
        goalKey={goalKey}
        isOpen={moveOpen}
        onOpenChange={setMoveOpen}
      />
      <GoalEditDialog
        goal={goal}
        isOpen={editOpen}
        onOpenChange={setEditOpen}
      />
      <ArchiveGoalDialog
        availableAmount={summary.availableAmount}
        currencyCode={currencyCode}
        goalKey={goalKey}
        isOpen={archiveOpen}
        onMoveMoneyOut={() => {
          setArchiveOpen(false);
          setMoveOpen(true);
        }}
        onOpenChange={setArchiveOpen}
      />
    </div>
  );
}
