"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import BankAccountSyncStatusBanner, {
  type BankSyncRecoveryState,
} from "@/components/account/BankAccountSyncStatusBanner";
import BudgetAccountSelectModal from "@/components/budget/BudgetAccountSelectModal";
import { BudgetsMonthlyViewOnboarding } from "@/components/onboarding/BudgetsMonthlyViewOnboarding";
import { BudgetsYearlyViewOnboarding } from "@/components/onboarding/BudgetsYearlyViewOnboarding";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Heading, Text } from "@/components/ui/Typography";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  clearBankAccountSyncReturnMarker,
  hasActiveBankAccountSyncReturnMarker,
} from "@/lib/account/bank-account-sync-return-marker";
import { safePostHogCapture } from "@/lib/analytics/safe-diagnostics";
import useAccounts from "@/lib/api/account/useAccounts";
import useBankAccountSyncStatus, {
  useLegacyBankAccountSyncStatus,
} from "@/lib/api/banking/useBankAccountSyncStatus";
import useBudget from "@/lib/api/budget/useBudget";
import useBudgetAccounts from "@/lib/api/budget/useBudgetAccounts";
import useEditBudgetTemplateAccounts from "@/lib/api/budget/useEditBudgetTemplateAccounts";
import { useUser } from "@/lib/auth/user-context";
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
  const searchParams = useSearchParams();

  const budgetKey = Number(params.budgetId);
  const year = Number(params.year);
  const month = params.month ? Number(params.month) : new Date().getMonth() + 1;

  // Account sync linking parameters after redirect
  const syncIncidentId = searchParams.get("sync");
  const legacyRequisitionId = syncIncidentId ? null : searchParams.get("nrid");
  const syncError = searchParams.get("err");

  const [selectedMonth, setSelectedMonth] = useState(month);
  const [accountSelectModalIsOpen, setAccountSelectModalIsOpen] =
    useState(false);
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(false);
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] =
    useState(false);

  useEffect(() => {
    if (!params.month) return;
    setSelectedMonth(Number(params.month));
  }, [params.month]);

  const { data: budgetData, isLoading: isLoadingBudget } = useBudget(
    budgetKey,
    { enabled: !!budgetKey, staleTime: 0 },
  );
  const { data: accountsData, isLoading: isLoadingAccountsData } =
    useAccounts();
  const { data: budgetAccounts, isLoading: isLoadingBudgetAccounts } =
    useBudgetAccounts(budgetKey, { enabled: !!budgetKey });

  const queryClient = useQueryClient();
  const user = useUser();
  const editBudgetAccountsMutation = useEditBudgetTemplateAccounts();

  const {
    data: bankSyncIncident,
    isError: isBankSyncTransportError,
    isRefetchError: isBankSyncRefetchError,
    isLoading: isLoadingRequisitionData,
    refetch: refetchBankSyncStatus,
  } = useBankAccountSyncStatus(syncIncidentId);
  const {
    legacyStatus,
    isLoading: isLoadingLegacyStatus,
    refetch: refetchLegacyBankSyncStatus,
  } = useLegacyBankAccountSyncStatus(user?.id, legacyRequisitionId);

  const bankSyncStatus: BankSyncRecoveryState = syncError
    ? "callback_error"
    : syncIncidentId &&
        (isBankSyncTransportError || isBankSyncRefetchError)
      ? "transport_unavailable"
      : syncIncidentId && (!bankSyncIncident || !bankSyncIncident.final)
        ? "processing"
        : bankSyncIncident?.final && bankSyncIncident.result === "partial"
          ? "partial"
          : bankSyncIncident?.final && bankSyncIncident.result === "failed"
            ? "failed"
            : legacyStatus === "full_success"
              ? "idle"
              : legacyStatus === "failed"
                ? "failed"
                : legacyStatus === "transport_unavailable"
                  ? "transport_unavailable"
                  : legacyStatus === "processing"
                    ? "processing"
                    : "idle";

  const callbackReference = syncIncidentId
    ? `sync:${syncIncidentId}`
    : legacyRequisitionId
      ? `legacy:${legacyRequisitionId}`
      : null;
  const hasAuthoritativeFullSuccess = syncIncidentId
    ? bankSyncIncident?.final === true &&
      bankSyncIncident.result === "full_success"
    : legacyStatus === "full_success";

  const handledSuccessRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      callbackReference &&
      hasAuthoritativeFullSuccess &&
      handledSuccessRef.current !== callbackReference
    ) {
      handledSuccessRef.current = callbackReference;

      void (async () => {
        const wasStartedFromThisPage = hasActiveBankAccountSyncReturnMarker(
          pathname,
        );
        await invalidateAccounts(queryClient);
        router.replace(pathname);
        clearBankAccountSyncReturnMarker();

        // The authoritative callback is sufficient. Session storage only adds
        // diagnostic context and must never gate the account-selection handoff.
        setAccountSelectModalIsOpen(true);
        safePostHogCapture(posthog, "account_add_sync_success", {
          source: "budget_callback",
          return_marker_available: wasStartedFromThisPage,
        });
      })();
    }
  }, [
    bankSyncIncident?.final,
    bankSyncIncident?.result,
    callbackReference,
    hasAuthoritativeFullSuccess,
    legacyStatus,
    pathname,
    posthog,
    queryClient,
    router,
    syncIncidentId,
  ]);

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
            // budgetKey/year pair above) that was previously never
            // invalidated here, leaving it stale until a hard reload.
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

  // It's loaded if there is a requisition and all accounts in that requisition
  // are loaded, which triggered a refresh of the accounts state
  const isLoadingRequisitionAccounts =
    bankSyncStatus === "processing" ||
    (bankSyncIncident?.final === true &&
      bankSyncIncident.result === "full_success" &&
      isLoadingAccountsData);

  return (
    <>
      <div className="my-2">
        <BankAccountSyncStatusBanner
          status={bankSyncStatus}
          callbackErrorCode={syncError}
          onRetryBankConnection={onAddSyncAccountClick}
          onAddAccountManually={onAddOfflineAccountClick}
          onRetryStatus={() => {
            if (syncIncidentId) void refetchBankSyncStatus();
            else if (legacyRequisitionId) void refetchLegacyBankSyncStatus();
          }}
        />
      </div>
      {!budgetData ||
      isLoadingBudget ||
      isLoadingRequisitionData ||
      isLoadingLegacyStatus ? (
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
              isLoadingRequisition={isLoadingRequisitionAccounts}
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
