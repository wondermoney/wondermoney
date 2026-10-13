import { Archive, ArrowLeft, MoreHorizontal, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";

import GoalProgressBar from "@/components/goals/GoalProgressBar";
import GoalStatusBadge from "@/components/goals/GoalStatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@/components/ui/Link";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import type { Goal, GoalSummary } from "@/lib/api/goals/types";
import {
  formatGoalCurrency,
  formatGoalDate,
  formatGoalPercentage,
} from "@/lib/goals/format";

function getCurrency(goal: Goal) {
  return (
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" && goal.currencyKey?.code
      ? goal.currencyKey.code
      : undefined)
  );
}

type GoalDetailHeaderProps = {
  readonly goal: Goal;
  readonly onArchive: () => void;
  readonly onAssignMoney: () => void;
  readonly onEdit: () => void;
  readonly onMoveMoneyOut: () => void;
  readonly summary: GoalSummary;
};

export default function GoalDetailHeader({
  goal,
  onArchive,
  onAssignMoney,
  onEdit,
  onMoveMoneyOut,
  summary,
}: GoalDetailHeaderProps) {
  const t = useTranslations();
  const locale = useLocale();
  const dialogOpenedFromMenu = useRef(false);
  const currency = getCurrency(goal);
  const progress = Math.min(100, Math.max(0, summary.progressPercentage ?? 0));

  const openManagementDialog = (openDialog: () => void) => {
    dialogOpenedFromMenu.current = true;
    openDialog();
  };

  return (
    // One header for the goal, on the shared ObjectHeader. "Available" was
    // both the object's key figure and the first cell of the 3-up grid below
    // — the same number twice, which is the defect fixed on goal *cards* in
    // 0b218f2c. It leads here; the grid keeps what is genuinely additional.
    <ObjectHeader
      backHref="/goals"
      backLabel={t("goals.title")}
      title={goal.name}
      subtitle={goal.description || undefined}
      badges={
        <GoalStatusBadge
          label={t(`goals.status-${goal.status}`)}
          status={goal.status}
        />
      }
      value={summary.availableAmount}
      currency={currency}
      valueLabel={t("goals.available")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAssignMoney}>{t("goals.assign-money")}</Button>
          <Button variant="secondary" onClick={onMoveMoneyOut}>
            {t("goals.move-money-out")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Ghost, not outline: this sits beside a solid primary and a
                  secondary, and a violet-bordered violet-lettered button
                  pulled as much attention as the primary next to it. */}
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="mr-2 size-4" aria-hidden="true" />
                {t("goals.manage")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                if (!dialogOpenedFromMenu.current) return;
                event.preventDefault();
                dialogOpenedFromMenu.current = false;
                document
                  .querySelector<HTMLElement>(
                    '[role="alertdialog"] button, [role="dialog"] button',
                  )
                  ?.focus();
              }}
            >
              <DropdownMenuItem onSelect={() => openManagementDialog(onEdit)}>
                <Pencil className="mr-2 size-4" aria-hidden="true" />
                {t("goals.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive-text focus:text-destructive-text"
                onSelect={() => openManagementDialog(onArchive)}
              >
                <Archive className="mr-2 size-4" aria-hidden="true" />
                {t("goals.archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">
              {t("goals.target-amount")}
            </p>
            <p className="font-mono text-lg font-semibold">
              {formatGoalCurrency(goal.targetAmount, currency, locale)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t("goals.progress")}
            </p>
            <p className="font-mono text-lg font-semibold">
              {formatGoalPercentage(progress, locale)}
            </p>
          </div>
          {goal.targetDate ? (
            <div>
              <p className="text-muted-foreground text-xs">
                {t("goals.target-date")}
              </p>
              <p className="font-mono text-lg font-semibold">
                {formatGoalDate(goal.targetDate, locale)}
              </p>
            </div>
          ) : null}
        </div>
        <GoalProgressBar value={progress} />
      </div>
    </ObjectHeader>
  );
}
