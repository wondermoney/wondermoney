"use client";

import BudgetsEmptyState from "@/components/budget/BudgetsEmptyState";
import { useRouter } from "@/i18n/navigation";

export function CreateBudgetEmptyButton() {
  const router = useRouter();

  const handleCreateBudget = () => {
    router.push("/budgets/wizard");
  };

  return <BudgetsEmptyState onCreateBudget={handleCreateBudget} />;
}
