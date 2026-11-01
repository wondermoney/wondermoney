"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import BankAccountSyncStatusBanner from "@/components/account/BankAccountSyncStatusBanner";
import BudgetAccountSelectModal from "@/components/budget/BudgetAccountSelectModal";
import { BudgetsMonthlyViewOnboarding } from "@/components/onboarding/BudgetsMonthlyViewOnboarding";
import { BudgetsYearlyViewOnboarding } from "@/components/onboarding/BudgetsYearlyViewOnboarding";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Heading, Text } from "@/components/ui/Typography";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useBankConnectionResult } from "@/lib/account/useBankConnectionResult";
import { safePostHogCapture } from "@/lib/analytics/safe-diagnostics";
import useAccounts from "@/lib/api/account/useAccounts";
import useBudget from "@/lib/api/budget/useBudget";
import useBudgetAccounts from "@/lib/api/budget/useBudgetAccounts";
import useEditBudgetTemplateAccounts from "@/lib/api/budget/useEditBudgetTemplateAccounts";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

export default function BudgetLayout({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const posthog = usePostHog();
  const pathname = usePathname();
  const params = useParams<{
    budgetId: string;
    year: string;
    month?: string;
  }>();

  const budgetKey = Number(params.budgetId);
  const year = Number(params.year);
  const month = params.month ? Number(params.month) : new Date().getMonth() + 1;

  // Back from a bank connection this budget started.
  const bankConnection = useBankConnectionResult();

  const [selectedMonth, setSelectedMonth] = useState(month);
  const [accountSelectModalIsOpen, setAccountSelectModalIsOpen] =
    useState(false);
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(false);
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] =
    useState(false);

  // Follow the month in the URL (adjusted during render, not in an effect).
  const [prevParamsMonth, setPrevParamsMonth] = useState(params.month);
  if (params.month !== prevParamsMonth) {
    setPrevParamsMonth(params.month);
    if (params.month) setSelectedMonth(Number(params.month));
  }

  const { data: budgetData, isLoading: isLoadingBudget } = useBudget(
    budgetKey,
    { enabled: !!budgetKey, staleTime: 0 },
  );
  const { data: accountsData, isLoading: isLoadingAccountsData } =
    useAccounts();
  const { data: budgetAccounts, isLoading: isLoadingBudgetAccounts } =
    useBudgetAccounts(budgetKey, { enabled: !!budgetKey });

  const queryClient = useQueryClient();
  const editBudgetAccountsMutation = useEditBudgetTemplateAccounts();

  const handledSuccessRef = useRef(false);

  // A new bank's accounts exist once the connection succeeded; offer to add
  // them to this budget.
  useEffect(() => {
    if (bankConnection !== "success" || handledSuccessRef.current) return;
    handledSuccessRef.current = true;

    void (async () => {
      await invalidateAccounts(queryClient);
      setAccountSelectModalIsOpen(true);
      safePostHogCapture(posthog, "account_add_sync_success", {
        source: "budget_callback",
      });
    })();
  }, [bankConnection, posthog, queryClient]);

  const navigateToYearView = () => {
    router.push(`/budgets/${budgetKey}/${year}`, undefined);
  };

  const navigateToMonthView = () => {
    router.push(`/budgets/${budgetKey}/${year}/${selectedMonth}`);
  };

  const updateBudgetAccounts = async (accountKeys: number[]) => {
    await editBudgetAccountsMutation.mutateAsync(
      { budgetKey, accountKeys },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["budget-accounts", budgetKey],
            }),
            queryClient.invalidateQueries({
              queryKey: ["budget-template-year-month", budgetKey, month, year],
            }),
            queryClient.invalidateQueries({
              queryKey: ["budget-template-year", budgetKey, year],
            }),
            // The yearly view's "year to date" totals come from a third,
            // separately-keyed query (object param, not the positional
            // budgetKey/year pair above); without invalidating it here it
            // stays stale until a hard reload.
            queryClient.invalidateQueries({
              queryKey: ["budget-template-year-until-month"],
            }),
            queryClient.invalidateQueries({ queryKey: ["budget", budgetKey] }),
          ]);
          // The month/year budget pages fetch their category totals as
          // Server Component props (see budget-month-client.tsx /
          // budget-year-client.tsx), not via these React Query hooks —
          // invalidating the client cache alone never touches that data.
          // router.refresh() re-runs the Server Component fetch so the
          // "Remaining this month" / per-category totals reflect the newly
          // linked accounts without a full page reload.
          router.refresh();
          setAccountSelectModalIsOpen(false);
          toast.success(t("toast-link-budget-accounts-success"));
        },
        onSettled: () => {
          safePostHogCapture(posthog, "link_existing_budget_accounts_success");
        },
        onError: () => {
          toast.success(t("toast-link-budget-accounts-error"));
        },
      },
    );
  };

  const onAccountsSelected = async (accountKeys: number[]) => {
    await updateBudgetAccounts(accountKeys);
  };

  const onAddSyncAccountClick = () => {
    setAccountAddSyncModalIsOpen(true);
    setAccountSelectModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_sync_modal", { action: "open" });
  };

  const onAddOfflineAccountClick = () => {
    setAccountAddOfflineModalIsOpen(true);
    setAccountSelectModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_offline_modal", {
      action: "open",
    });
  };

  const closeAccountAddOfflineModal = () => {
    setAccountAddOfflineModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_offline_modal", {
      action: "close",
    });
  };

  const closeAccountAddSyncModal = () => {
    setAccountAddSyncModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_sync_modal", { action: "close" });
  };

  return (
    <>
      {bankConnection === "error" ? (
        <div className="my-2">
          <BankAccountSyncStatusBanner
            onRetryBankConnection={onAddSyncAccountClick}
            onAddAccountManually={onAddOfflineAccountClick}
          />
        </div>
      ) : null}
      {!budgetData || isLoadingBudget ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
            <div className="flex flex-col justify-center gap-2">
              <div className="flex items-center gap-2">
                <Heading variant="h2">{budgetData.budget.name}</Heading>
                {params.month === undefined ? (
                  <BudgetsYearlyViewOnboarding />
                ) : (
                  <BudgetsMonthlyViewOnboarding />
                )}
              </div>
              {budgetData.budget.description && (
                <Text className="text-muted-foreground">
                  {budgetData.budget.description}
                </Text>
              )}
            </div>
            <BudgetAccountSelectModal
              isOpen={accountSelectModalIsOpen}
              isLoadingRequisition={isLoadingAccountsData}
              accounts={accountsData?.accounts}
              budgetAccounts={budgetAccounts?.accounts}
              setOpen={setAccountSelectModalIsOpen}
              onAddSyncAccountClick={onAddSyncAccountClick}
              onAddOfflineAccountClick={onAddOfflineAccountClick}
              onAccountsSelected={onAccountsSelected}
            />
            <AccountAddOfflineModal
              isOpen={accountAddOfflineModalIsOpen}
              closeModal={closeAccountAddOfflineModal}
            />
            <AccountAddSyncModal
              isOpen={accountAddSyncModalIsOpen}
              setOpen={closeAccountAddSyncModal}
              page={pathname}
            />
          </div>
          <Tabs value={params.month !== undefined ? "month" : "year"}>
            <Text variant="smallText" className="text-muted-foreground mr-2">
              {t("view-by")}:
            </Text>
            <TabsList>
              <TabsTrigger value="month" onClick={navigateToMonthView}>
                {t("month")}
              </TabsTrigger>
              <TabsTrigger value="year" onClick={navigateToYearView}>
                {t("year")}
              </TabsTrigger>
            </TabsList>
            {children}
          </Tabs>
        </div>
      )}
    </>
  );
}
