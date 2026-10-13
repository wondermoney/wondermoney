"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

export function CreateBudgetButton() {
  const router = useRouter();
  const t = useTranslations();

  const handleCreateBudget = () => {
    router.push("/budgets/wizard");
  };

  return (
    <Button onClick={handleCreateBudget} size="sm" className="gap-2">
      {t("create-budget")}
    </Button>
  );
}
