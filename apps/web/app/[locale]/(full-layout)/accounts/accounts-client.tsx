"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MoveUpRight, Plus, TrendingDown, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useRef, useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import AccountsEmptyStateV2 from "@/components/account/AccountsEmptyStateV2";
import AccountsList from "@/components/account/AccountsList";
import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import BankAccountSyncStatusBanner, {
  type BankSyncRecoveryState,
} from "@/components/account/BankAccountSyncStatusBanner";
import MetricsCards from "@/components/account/MetricsCards";
import TransactionsList from "@/components/account/TransactionsList";
import TimeframeSelect from "@/components/dashboard/TimeframeSelect";
import { AccountsOnboarding } from "@/components/onboarding/AccountsOnboarding";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { DataProvenance } from "@/components/ui/DataProvenance";
import { Link } from "@/components/ui/Link";
import { StatCardsSkeleton } from "@/components/ui/PageSkeleton";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { getAggregateFreshness } from "@/lib/account/accounts-freshness";
import { aggregateMetrics } from "@/lib/account/accounts-metrics";
import {
  getAccountsCashflowFromDate,
  getAccountsOverviewCurrencyCode,
} from "@/lib/account/accounts-overview-state";
import {
  safelyRunDiagnostic,
  safePostHogCapture,
} from "@/lib/analytics/safe-diagnostics";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import useAccountsCashflow from "@/lib/api/account/useAccountsCashflow";
import useAccountsMetrics from "@/lib/api/account/useAccountsMetrics";
import useTransactions from "@/lib/api/account/useTransactions";
import useTransactionsCategorySpending from "@/lib/api/account/useTransactionsCategorySpending";
import useBankAccountSyncStatus, {
  useLegacyBankAccountSyncStatus,
} from "@/lib/api/banking/useBankAccountSyncStatus";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";
import { useUser } from "@/lib/auth/user-context";
import {
  cancelFirstRunHandoff,
  completeFirstRunHandoff,
  getFirstRunStepRoute,
} from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
} from "@/lib/utils/analytics";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { resolveCategoryColor } from "@/lib/utils/categoryColor";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import {
  type AccountsTimeframe,
  getAccountsTimeframeRange,
} from "./accounts-timeframe";

// Code-split heavy chart components
const AccountsCashflowChart = dynamic(
  () => import("@/components/account/AccountsCashflowChart"),
  { loading: () => <Spinner /> },
);
const AccountTransactionsChart = dynamic(
  () => import("@/components/account/AccountTransactionsChart"),
  { loading: () => <Spinner /> },
);

interface AccountsClientProps {
  initialAccountsData: GetAccountsResponse;
  initialConfigsData: GetConfigsResponse;
}

const SAFE_BANK_ERROR_CATEGORIES = new Set([
  "authentication",
  "cancelled",
  "consent",
  "data_validation",
  "internal",
  "provider",
  "queue",
  "timeout",
  "unknown",
]);
const SAFE_BANK_ERROR_CODES = new Set([
  "account_phase_failed",
  "authentication",
  "cancelled",
  "consent_expired",
  "data_validation",
  "institution_unavailable",
  "internal",
  "invalid_requisition",
  "provider_unavailable",
  "queue_unavailable",
  "rate_limited",
  "timeout",
  "transaction_phase_failed",
  "unknown",
]);

type BankRecoveryEventProperties = {
  locale: string;
  source: "accounts_callback" | "accounts_recovery";
  state: BankSyncRecoveryState;
  result?: "pending" | "full_success" | "partial" | "failed";
  error_category?: string;
  error_code?: string;
  fallback_type?: "bank" | "manual" | "statement";
};

function safeCaptureBankRecoveryEvent(
  posthog: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
  },
  event: string,
  properties: BankRecoveryEventProperties,
) {
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics is diagnostic only and must never interrupt recovery actions.
  }
}

const safeErrorValue = (value: string | undefined, allowlist: Set<string>) =>
  value && allowlist.has(value) ? value : value ? "unknown" : undefined;

// ---------- Main Component ----------

export default function AccountsClient({
  initialAccountsData,
  initialConfigsData,
}: AccountsClientProps) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const user = useUser();
  const locale = useLocale();
  const syncIncidentId = searchParams.get("sync");
  const legacyRequisitionId = syncIncidentId ? null : searchParams.get("nrid");
  const syncError = searchParams.get("err");

  // Timeframe management
  const timeframes = [
    { label: t("timeframe-1m"), value: "1M" },
    { label: t("timeframe-3m"), value: "3M" },
    { label: t("timeframe-6m"), value: "6M" },
    { label: t("timeframe-ytd"), value: "YTD" },
    { label: t("timeframe-1y"), value: "1Y" },
    { label: t("timeframe-all"), value: "ALL" },
  ];

  const [timeframe, setTimeframe] = useState<AccountsTimeframe>("YTD");
  const { fromDate, toDate } = useMemo(
    () => getAccountsTimeframeRange(timeframe),
    [timeframe],
  );

  // Data hooks
  const {
    data: accountsData,
    isError: isAccountsError,
    isFetching: isAccountsFetching,
    isLoading: isLoadingAccountsData,
  } = useAccounts({ initialData: initialAccountsData });

  const {
    data: transactionsData,
    isLoading: isLoadingTransactionsData,
    isPlaceholderData: isTransactionsPlaceholderData,
  } = useTransactions({ includeEmptyAccounts: true, fromDate, toDate });

  const cashflowFromDate = useMemo(
    () => getAccountsCashflowFromDate(fromDate),
    [fromDate],
  );

  const {
    data: accountsCashflowData,
    isLoading: isLoadingAccountsCashflowData,
    isPlaceholderData: isAccountsCashflowPlaceholderData,
  } = useAccountsCashflow({ fromDate: cashflowFromDate });

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs({
    initialData: initialConfigsData,
  });

  const isLoadingTransactions = isLoadingTransactionsData || isLoadingConfigs;

  const {
    data: accountsMetricsData,
    isLoading: isLoadingAccountsMetricsData,
    isPlaceholderData: isAccountsMetricsPlaceholderData,
  } = useAccountsMetrics({ fromDate, toDate });

  const { data: categorySpendingData, isLoading: isLoadingCategorySpending } =
    useTransactionsCategorySpending({ fromDate, toDate, limit: 6 });

  // The incident API is the only authority for terminal bank-sync state.
  const {
    data: bankSyncIncident,
    isError: isBankSyncTransportError,
    isRefetchError: isBankSyncRefetchError,
    refetch: refetchBankSyncStatus,
  } = useBankAccountSyncStatus(syncIncidentId);
  const { legacyStatus, refetch: refetchLegacyBankSyncStatus } =
    useLegacyBankAccountSyncStatus(user?.id, legacyRequisitionId);

  const bankSyncStatus: BankSyncRecoveryState = syncError
    ? "callback_error"
    : syncIncidentId && (isBankSyncTransportError || isBankSyncRefetchError)
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
  const capturedDiagnosticRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      callbackReference &&
      hasAuthoritativeFullSuccess &&
      handledSuccessRef.current !== callbackReference
    ) {
      handledSuccessRef.current = callbackReference;

      void (async () => {
        await invalidateAccounts(queryClient);

        if (
          completeFirstRunHandoff(
            "account",
            {
              accountStep: "connected",
              currentStep: "sync_value",
            },
            user?.id,
          )
        ) {
          safelyRunDiagnostic(() => {
            captureActivationEvent(
              posthog,
              ACTIVATION_EVENTS.firstAccountAdded,
              {
                account_count: Math.max(1, accountsData?.accounts?.length ?? 1),
                account_source: "sync",
                locale,
              },
            );
            captureActivationEvent(
              posthog,
              ACTIVATION_EVENTS.onboardingStepCompleted,
              { account_source: "sync", step: "account" },
            );
          });
          router.replace(getFirstRunStepRoute("sync_value"));
          return;
        }

        router.replace("/accounts");
      })();
    }
  }, [
    accountsData?.accounts?.length,
    callbackReference,
    bankSyncIncident?.final,
    bankSyncIncident?.result,
    hasAuthoritativeFullSuccess,
    legacyStatus,
    locale,
    posthog,
    queryClient,
    router,
    syncIncidentId,
    user?.id,
  ]);

  useEffect(() => {
    if (bankSyncStatus === "idle" || bankSyncStatus === "processing") return;
    const diagnosticKey = `${syncIncidentId ?? "callback"}:${bankSyncStatus}`;
    if (capturedDiagnosticRef.current === diagnosticKey) return;
    capturedDiagnosticRef.current = diagnosticKey;
    safeCaptureBankRecoveryEvent(posthog, "bank_sync_recovery_displayed", {
      locale,
      source: "accounts_callback",
      state: bankSyncStatus,
      result: bankSyncIncident?.result,
      error_category: safeErrorValue(
        bankSyncIncident?.errorCategory,
        SAFE_BANK_ERROR_CATEGORIES,
      ),
      error_code: safeErrorValue(
        bankSyncIncident?.errorCode,
        SAFE_BANK_ERROR_CODES,
      ),
    });
  }, [
    bankSyncIncident?.errorCategory,
    bankSyncIncident?.errorCode,
    bankSyncIncident?.result,
    bankSyncStatus,
    locale,
    posthog,
    syncIncidentId,
  ]);

  // Modal state
  const firstRunMode = searchParams.get("firstRun");
  const shouldOpenAdd = searchParams.get("add") === "true";
  const [accountAddModalIsOpen, setAccountAddModalIsOpen] = useState(
    shouldOpenAdd && !firstRunMode,
  );
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] = useState(
    shouldOpenAdd && firstRunMode === "sync",
  );
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(shouldOpenAdd && firstRunMode === "manual");
  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pendingCsvImport, setPendingCsvImport] = useState(false);
  const [isRecoveryCsvImport, setIsRecoveryCsvImport] = useState(false);
  const formatCurrency = useFormatCurrency();

  const onAddSyncAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddSyncModalIsOpen(true);
    safePostHogCapture(posthog, "account_add_sync_modal", { action: "open" });
  };
  const onRecoveryRetry = () => {
    safeCaptureBankRecoveryEvent(posthog, "bank_sync_recovery_selected", {
      locale,
      source: "accounts_recovery",
      state: bankSyncStatus,
      result: bankSyncIncident?.result,
      fallback_type: "bank",
    });
    onAddSyncAccountClick();
  };
  const closeAccountAddSyncModal = () => {
    setAccountAddSyncModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_sync_modal", { action: "close" });
  };
  const onAddOfflineAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddOfflineModalIsOpen(true);
    safePostHogCapture(posthog, "account_add_offline_modal", {
      action: "open",
    });
  };
  const onRecoveryManual = () => {
    safeCaptureBankRecoveryEvent(posthog, "bank_sync_recovery_selected", {
      locale,
      source: "accounts_recovery",
      state: bankSyncStatus,
      result: bankSyncIncident?.result,
      fallback_type: "manual",
    });
    onAddOfflineAccountClick();
  };
  const onRecoveryImport = () => {
    safeCaptureBankRecoveryEvent(posthog, "bank_sync_recovery_selected", {
      locale,
      source: "accounts_recovery",
      state: bankSyncStatus,
      result: bankSyncIncident?.result,
      fallback_type: "statement",
    });
    setIsRecoveryCsvImport(true);
    if ((accountsData?.accounts?.length ?? 0) === 0) {
      setPendingCsvImport(true);
      onAddOfflineAccountClick();
      return;
    }
    setIsImportModalOpen(true);
  };
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
    safePostHogCapture(
      posthog,
      "account_transaction_table_add_manual_transaction",
      {
        action: "open",
        source: "accounts_overview",
      },
    );
  };
  const closeAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(false);
    safePostHogCapture(
      posthog,
      "account_transaction_table_add_manual_transaction",
      {
        action: "close",
        source: "accounts_overview",
      },
    );
  };
  const closeAccountAddOfflineModal = () => {
    setAccountAddOfflineModalIsOpen(false);
    safePostHogCapture(posthog, "account_add_offline_modal", {
      action: "close",
    });
  };
  const handleOfflineAccountSuccess = async () => {
    if (pendingCsvImport) {
      setPendingCsvImport(false);
      setIsImportModalOpen(true);
      return;
    }

    if (
      completeFirstRunHandoff(
        "account",
        { accountStep: "manual_added", currentStep: "sync_value" },
        user?.id,
      )
    ) {
      safelyRunDiagnostic(() => {
        captureActivationEvent(posthog, ACTIVATION_EVENTS.firstAccountAdded, {
          account_count: Math.max(1, accountsData?.accounts?.length ?? 1),
          account_source: "manual",
          locale,
        });
        captureActivationEvent(
          posthog,
          ACTIVATION_EVENTS.onboardingStepCompleted,
          { account_source: "manual", step: "account" },
        );
      });
      router.replace(getFirstRunStepRoute("sync_value"));
    }
  };

  const handleCsvImportSuccess = () => {
    setPendingCsvImport(false);
    setIsRecoveryCsvImport(false);
    setIsImportModalOpen(false);

    if (
      completeFirstRunHandoff(
        "account",
        { accountStep: "manual_added", currentStep: "sync_value" },
        user?.id,
      )
    ) {
      safelyRunDiagnostic(() => {
        captureActivationEvent(posthog, ACTIVATION_EVENTS.firstAccountAdded, {
          account_count: Math.max(1, accountsData?.accounts?.length ?? 1),
          account_source: "statement",
          locale,
        });
        captureActivationEvent(
          posthog,
          ACTIVATION_EVENTS.onboardingStepCompleted,
          { account_source: "statement", step: "account" },
        );
      });
      router.replace(getFirstRunStepRoute("sync_value"));
      return;
    }

    router.replace("/accounts");
  };

  const setRecoveryImportModalOpen = (open: boolean) => {
    setIsImportModalOpen(open);
    if (open || !isRecoveryCsvImport) return;

    setPendingCsvImport(false);
    setIsRecoveryCsvImport(false);
    if (cancelFirstRunHandoff("account", "account", user?.id)) {
      router.replace(getFirstRunStepRoute("account"));
      return;
    }
    router.replace("/accounts");
  };

  useEffect(() => {
    if (pendingCsvImport && (accountsData?.accounts?.length ?? 0) > 0) {
      setPendingCsvImport(false);
      setIsImportModalOpen(true);
    }
  }, [accountsData?.accounts?.length, pendingCsvImport]);

  // Loading state
  if (isLoadingAccountsData) {
    return <Spinner />;
  }

  // If server-side fetch returned empty but client is still refetching,
  // show a spinner until we know the real state. This handles the case
  // where accounts were created (e.g. during onboarding) but the server
  // component fetch ran before the API had them, while the client-side
  // refetch will return the real accounts.
  if (
    initialAccountsData &&
    (!initialAccountsData.accounts ||
      initialAccountsData.accounts.length === 0) &&
    isAccountsFetching
  ) {
    return <Spinner />;
  }

  const hasAccounts =
    !isLoadingAccountsData &&
    accountsData?.accounts &&
    accountsData.accounts.length > 0;

  const recoveryBanner = (
    <BankAccountSyncStatusBanner
      status={bankSyncStatus}
      callbackErrorCode={syncError}
      csvRequiresAccount={!hasAccounts}
      onRetryBankConnection={onRecoveryRetry}
      onAddAccountManually={onRecoveryManual}
      onImportStatement={onRecoveryImport}
      onRetryStatus={() => {
        if (syncIncidentId) void refetchBankSyncStatus();
        else if (legacyRequisitionId) void refetchLegacyBankSyncStatus();
      }}
    />
  );

  // Empty state — data-forward preview
  if (!hasAccounts && bankSyncStatus === "idle") {
    return <AccountsEmptyStateV2 />;
  }

  if (!hasAccounts) {
    return (
      <div className="flex flex-col gap-6">
        <AccountsEmptyStateV2 recoveryState={recoveryBanner} />
        <AccountAddSyncModal
          isOpen={accountAddSyncModalIsOpen}
          setOpen={closeAccountAddSyncModal}
        />
        <AccountAddOfflineModal
          isOpen={accountAddOfflineModalIsOpen}
          closeModal={closeAccountAddOfflineModal}
          onSuccess={handleOfflineAccountSuccess}
          onCancel={() => {
            setPendingCsvImport(false);
            setIsRecoveryCsvImport(false);
          }}
        />
      </div>
    );
  }

  // Compute total balance and net change from metrics
  const totalBalance =
    accountsData?.accounts?.reduce<number | null>(
      (sum, account) =>
        sum === null || account.appuserCurrencyBalance === null
          ? null
          : sum + account.appuserCurrencyBalance,
      0,
    ) ?? null;
  const userCurrency = getAccountsOverviewCurrencyCode(
    accountsData?.accounts?.[0]?.accountOwnerAppuserKey?.currencyKey?.code,
  );

  // Net change = inflow - outflow for the period
  const metricsAgg =
    accountsMetricsData?.metrics && accountsMetricsData.metrics.length > 0
      ? aggregateMetrics(accountsMetricsData.metrics)
      : null;
  const netChange = metricsAgg
    ? metricsAgg.inflowCurrent - metricsAgg.outflowCurrent
    : null;

  const accountsFreshness = getAggregateFreshness(accountsData?.accounts);

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t("accounts-overview")}
            </h1>
            <AccountsOnboarding />
          </div>
          {/* No subtitle. It read "This is a summary of your accounts,
              including balance growth, latest transactions and insights" —
              a description of what the page already shows, above the page
              showing it. § 9's subtitle rule, applied per route rather than
              swept: Goals keeps its line, because "set aside budgeted money"
              explains the envelope concept the feature rests on. */}
        </div>
        <div className="flex w-auto flex-col gap-2 xl:flex-row xl:items-center xl:justify-end">
          <TimeframeSelect
            timeframes={timeframes}
            timeframe={timeframe}
            setTimeframe={(value) => setTimeframe(value as AccountsTimeframe)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {hasAccounts ? (
              <AccountTransactionAddModal
                isOpen={isAddManualTransactionModalOpen}
                setOpen={(open) =>
                  open
                    ? openAddManualTransactionModal()
                    : closeAddManualTransactionModal()
                }
                accounts={accountsData?.accounts ?? []}
                trigger={
                  <Button size="sm" className="w-full gap-1.5">
                    <Plus className="size-3.5" />
                    {t("add-transaction")}
                  </Button>
                }
              />
            ) : null}
            <AccountAddModal
              isOpen={accountAddModalIsOpen}
              setOpen={setAccountAddModalIsOpen}
              onAddSyncAccountClick={onAddSyncAccountClick}
              onAddOfflineAccountClick={onAddOfflineAccountClick}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  aria-label={t("add-account")}
                >
                  <Plus className="size-3.5" />
                  {t("add-account")}
                </Button>
              }
            />
          </div>
        </div>
      </div>

      {/* Alerts */}
      {recoveryBanner}

      {/* Total balance hero */}
      <div className="border-border bg-card rounded-lg border p-5">
        <p className="text-muted-foreground text-sm">{t("total-balance")}</p>
        {/* `flex-wrap`, and the delta group cannot shrink: without either, at
            320px the 3xl figure took the full line and the change printed on
            top of it. The figure goes through <Amount> so a missing total is
            an em-dash with the reason beneath, rather than a sentence sitting
            in the slot where a number belongs. § 9 rules 1, 3 and 5. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Amount
            value={totalBalance}
            currency={userCurrency}
            className="font-mono text-3xl font-semibold tracking-tight"
          />
          {totalBalance !== null && netChange !== null && netChange !== 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {netChange > 0 ? (
                <TrendingUp className="text-success-text h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="text-destructive-text h-3.5 w-3.5" />
              )}
              <Amount
                value={netChange}
                currency={userCurrency}
                tone="delta"
                signed
                className="font-mono text-sm font-medium"
              />
              <span className="text-muted-foreground text-xs">
                {t("vs-previous-period")}
              </span>
            </div>
          )}
        </div>
        {totalBalance === null ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {t("total-balance-incomplete")}
          </p>
        ) : null}
        {/* § 9 rule 6. A total summed from bank connections with no "as of"
            invites the reader to assume it is live. The timestamp is the
            *oldest* sync in the set, because the total is only as current as
            its stalest component. */}
        {accountsFreshness ? (
          <DataProvenance
            className="mt-1.5"
            updatedAt={accountsFreshness.oldestSyncedAt}
            isStale={accountsFreshness.isStale}
            errorLabel={
              accountsFreshness.hasError
                ? t("provenance-balances-stale")
                : undefined
            }
            label={(time) => t("provenance-balances-updated", { time })}
          />
        ) : null}
      </div>

      {/* Metrics cards */}
      <section>
        {/* A skeleton in the cards' own shape, not a 96px box with a spinner
            in it — the spinner told you nothing and then reflowed the page
            when it stopped. § 9. */}
        {isLoadingAccountsMetricsData && !isAccountsMetricsPlaceholderData ? (
          <StatCardsSkeleton />
        ) : accountsMetricsData?.metrics &&
          accountsMetricsData.metrics.length > 0 ? (
          <MetricsCards
            metrics={accountsMetricsData.metrics}
            userCurrency={userCurrency}
          />
        ) : (
          <div className="border-border bg-card rounded-lg border px-4 py-8 text-center">
            <p className="text-muted-foreground text-sm">{t("no-metrics")}</p>
          </div>
        )}
      </section>

      {/* Spending by category */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("spending-by-category")}
          </h2>
        </div>
        <div className="p-5">
          {isLoadingCategorySpending ? (
            <div className="flex h-30 items-center justify-center">
              <Spinner />
            </div>
          ) : categorySpendingData?.categorySpending &&
            categorySpendingData.categorySpending.length > 0 ? (
            <div className="divide-border divide-y">
              {categorySpendingData.categorySpending.map((cat, catIndex) => {
                const totalSpending =
                  categorySpendingData.categorySpending.reduce(
                    (sum, c) => sum + Math.abs(c.amount),
                    0,
                  );
                const pct =
                  totalSpending > 0
                    ? (Math.abs(cat.amount) / totalSpending) * 100
                    : 0;

                return (
                  <div
                    key={cat.categoryKey}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: `color-mix(in oklch, ${resolveCategoryColor(cat.bgColor, catIndex)} 15%, transparent)`,
                        color: resolveCategoryColor(cat.bgColor, catIndex),
                      }}
                    >
                      <CategoryIcon
                        icon={cat.icon}
                        category={!cat.icon ? cat.name : undefined}
                        width="16px"
                        height="16px"
                        className="text-current"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground truncate text-sm">
                          {t(getCategoryTranslationKey(cat.name))}
                        </span>
                        <span className="text-foreground shrink-0 font-mono text-sm font-medium">
                          <Amount value={Math.abs(cat.amount)} currency={cat.currency ?? userCurrency} />
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: resolveCategoryColor(
                                cat.bgColor,
                                catIndex,
                              ),
                            }}
                          />
                        </div>
                        <span className="text-muted-foreground w-8 text-right text-xs">
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-30 items-center justify-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-category-spending-description")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Balance chart */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("balance-growth")}
          </h2>
        </div>
        <div className="p-5">
          {isLoadingTransactionsData && !isTransactionsPlaceholderData ? (
            <div className="flex h-75 items-center justify-center">
              <Spinner />
            </div>
          ) : transactionsData?.transactions &&
            transactionsData.transactions.length > 0 ? (
            <AccountTransactionsChart
              currencyCode={userCurrency}
              transactions={transactionsData.transactions}
              fromDate={fromDate}
              toDate={toDate}
            />
          ) : (
            <div className="flex h-50 items-center justify-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Accounts + Transactions grid */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Accounts list */}
        <div className="lg:col-span-2">
          <div className="border-border bg-card rounded-lg border">
            <div className="border-border border-b px-5 py-3">
              <h2 className="text-foreground text-sm font-medium">
                {t("accounts")}
              </h2>
            </div>
            <AccountsList accounts={accountsData?.accounts ?? []} />
          </div>
        </div>

        {/* Recent transactions */}
        <div className="lg:col-span-3">
          <div className="border-border bg-card rounded-lg border">
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-foreground text-sm font-medium">
                {t("last-transactions")}
              </h2>
              <Link
                href="/accounts/transactions"
                className="text-primary text-xs font-medium no-underline hover:underline"
              >
                {t("view-all")}{" "}
                <MoveUpRight strokeWidth={2} className="ml-0.5 inline size-3" />
              </Link>
            </div>
            {isLoadingTransactions ? (
              <div className="flex h-50 items-center justify-center">
                <Spinner />
              </div>
            ) : transactionsData?.transactions &&
              transactionsData.transactions.length > 0 ? (
              <TransactionsList transactions={transactionsData.transactions} />
            ) : (
              <div className="flex h-50 items-center justify-center px-4 text-center">
                <div className="flex flex-col items-center gap-3">
                  <p className="text-muted-foreground text-sm">
                    {t("empty-transactions-description")}
                  </p>
                  {hasAccounts ? (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={openAddManualTransactionModal}
                    >
                      <Plus className="size-3.5" />
                      {t("add-transaction")}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cashflow chart */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("cashflow")}
          </h2>
        </div>
        <div className="p-5">
          {isLoadingAccountsCashflowData &&
          !isAccountsCashflowPlaceholderData ? (
            <div className="flex h-75 items-center justify-center">
              <Spinner />
            </div>
          ) : accountsCashflowData?.cashflow &&
            accountsCashflowData.cashflow.length > 0 ? (
            <AccountsCashflowChart
              currencyCode={userCurrency}
              data={accountsCashflowData.cashflow}
            />
          ) : (
            <div className="flex h-50 items-center justify-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Modals */}
      <AccountAddSyncModal
        isOpen={accountAddSyncModalIsOpen}
        setOpen={closeAccountAddSyncModal}
      />
      <AccountAddOfflineModal
        isOpen={accountAddOfflineModalIsOpen}
        closeModal={closeAccountAddOfflineModal}
        onSuccess={handleOfflineAccountSuccess}
        onCancel={() => {
          setPendingCsvImport(false);
          setIsRecoveryCsvImport(false);
        }}
      />
      {hasAccounts ? (
        <AccountTransactionImportModal
          isOpen={isImportModalOpen}
          setOpen={setRecoveryImportModalOpen}
          accounts={accountsData?.accounts ?? []}
          onImportSuccess={handleCsvImportSuccess}
        />
      ) : null}
    </div>
  );
}
