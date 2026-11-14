"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import InstallmentPlanDetail from "@/components/installments/InstallmentPlanDetail";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { canEditAccount } from "@/lib/account/account-access";
import useAccounts from "@/lib/api/account/useAccounts";
import useConfigs from "@/lib/api/configs/useConfigs";
import { useInstallmentPlan } from "@/lib/api/installment-plans/useInstallmentPlans";

export default function InstallmentPlanClient({ planId }: { planId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { data, isLoading, isError } = useInstallmentPlan(planId);
  const { data: configsData } = useConfigs();
  const { data: accountsData } = useAccounts();

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const plan = data?.installmentPlan;
  if (isError || !plan) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-foreground text-lg font-semibold">
          {t("installments.load-failed")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("installments.load-failed-body")}
        </p>
        <Button variant="secondary" onClick={() => router.push("/accounts")}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("accounts")}
        </Button>
      </div>
    );
  }

  return (
    <InstallmentPlanDetail
      plan={plan}
      categories={configsData?.categories ?? []}
      onDeleted={() => router.push(`/accounts/${plan.accountKey}`)}
      readOnly={
        !canEditAccount(
          accountsData?.accounts.find(
            (account) => account.accountKey === plan.accountKey,
          ),
        )
      }
    />
  );
}
