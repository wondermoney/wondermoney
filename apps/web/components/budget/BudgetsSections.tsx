"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { SectionHeader } from "@/components/layout/SectionHeader";
import { Card } from "@/components/ui/card";
import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";
import { groupBudgetsByVisibility } from "@/lib/budget/visibility";

import BudgetsTable from "./BudgetsTable";

/**
 * The budgets list. With household and personal budgets both present they
 * are two sections, household first; with one kind there is nothing to tell
 * apart, so it stays the one "Budgets" section. `actions` (the create button)
 * sits on the first section only.
 */
export function BudgetsSections({
  budgets,
  actions,
}: {
  budgets: BudgetFull[];
  actions?: ReactNode;
}) {
  const t = useTranslations();
  const groups = groupBudgetsByVisibility(budgets);
  const isGrouped = groups.length > 1;

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group, index) => (
        <section key={group.visibility} className="flex flex-col gap-2">
          <SectionHeader
            title={
              isGrouped
                ? t(`budgetVisibility.${group.visibility}-budgets`)
                : t("budgets")
            }
            actions={index === 0 ? actions : undefined}
          />
          <Card className="border-none">
            <BudgetsTable budgets={group.budgets} />
          </Card>
        </section>
      ))}
    </div>
  );
}
