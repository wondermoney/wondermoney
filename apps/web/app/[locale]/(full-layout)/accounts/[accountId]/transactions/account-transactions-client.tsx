"use client";

import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useState } from "react";
import { DateRange } from "react-day-picker";

import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import TransactionsTable from "@/components/account/AccountTransactionsTable";
import ProjectedTransactions from "@/components/account/ProjectedTransactions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import type { GetAccountResponse } from "@/lib/api/account/useAccount";
import useAccount from "@/lib/api/account/useAccount";
import type { GetAccountForecastResponse } from "@/lib/api/account/useAccountForecast";
import useAccountForecast from "@/lib/api/account/useAccountForecast";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetAccountTransactionsResponse } from "@/lib/api/account/useAccountTransactions";
import useAccountTransactions from "@/lib/api/account/useAccountTransactions";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";
import { serverSeed } from "@/lib/query/server-seed";

interface AccountTransactionsClientProps {
  accountId: number;
  showUnreviewedOnly: boolean;
  serverRenderedAt: number;
  initialAccountData: GetAccountResponse;
  initialTransactionsData: GetAccountTransactionsResponse;
  initialConfigsData: GetConfigsResponse;
  initialForecastData: GetAccountForecastResponse;
  hasAnyTransactions: boolean;
  defaultDateRange: { from: Date; to: Date };
}

export default function AccountTransactionsClient({
  accountId,
  showUnreviewedOnly,
  serverRenderedAt,
  initialAccountData,
  initialTransactionsData,
  initialConfigsData,
  initialForecastData,
  hasAnyTransactions,
  defaultDateRange,
}: AccountTransactionsClientProps) {
  const t = useTranslations();
  const posthog = usePostHog();

  const { data: accountsData, isLoading: isLoadingAccountsData } = useAccount(
    accountId,
    serverSeed(initialAccountData, serverRenderedAt),
  );
  const { data: accountsListData, isLoading: isLoadingAccountsList } =
    useAccounts();
  const transactionAccount = accountsListData?.accounts.find(
    (account) => account.accountKey === accountId,
  );

  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
    posthog.capture("account_transaction_table_add_manual_transaction", {
      action: "open",
    });
  };
  const closeAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(false);
    posthog.capture("account_transaction_table_add_manual_transaction", {
      action: "close",
    });
  };

  const [isImportTransactionModalOpen, setIsImportTransactionModalOpen] =
    useState(false);
  const openImportTransactionModal = () => {
    setIsImportTransactionModalOpen(true);
    posthog.capture("account_transaction_table_import_transaction", {
      action: "open",
    });
  };
  const closeImportTransactionModal = () => {
    setIsImportTransactionModalOpen(false);
    posthog.capture("account_transaction_table_import_transaction", {
      action: "close",
    });
  };

  const [hasUsedDateFilter, setHasUsedDateFilter] = useState(false);
  const [transactionDateRange, setTransactionDateRange] = useState<
    DateRange | undefined
  >({ from: defaultDateRange.from, to: defaultDateRange.to });
  const handleDateRangeChange = (dateRange?: DateRange) => {
    setTransactionDateRange(dateRange);
    setHasUsedDateFilter(true);
  };

  /*
   * The table's type and category filters, lifted so they reach the endpoint.
   *
   * Filtering in the browser over the loaded rows would be wrong: this endpoint caps at `limit`
   * (default 100), so filtering one account's year by category would filter whichever 100 rows
   * came back. No account
   * filter here: the page already scopes to one account and hides that control.
   */
  const [tableFilters, setTableFilters] = useState<{
    categoryKeys: string[];
    needsReview: boolean;
    tagKeys: string[];
    transactionTypes: string[];
  }>({
    categoryKeys: [],
    needsReview: false,
    tagKeys: [],
    transactionTypes: [],
  });

  const handleTableFiltersChange = useCallback(
    (next: {
      categoryKeys: string[];
      needsReview: boolean;
      tagKeys: string[];
      transactionTypes: string[];
    }) => {
      // The table re-reports from an effect, so bail when nothing moved or this loops.
      setTableFilters((current) =>
        current.needsReview === next.needsReview &&
        current.categoryKeys.join() === next.categoryKeys.join() &&
        current.tagKeys.join() === next.tagKeys.join() &&
        current.transactionTypes.join() === next.transactionTypes.join()
          ? current
          : next,
      );
    },
    [],
  );

  const hasTableFilters =
    tableFilters.categoryKeys.length > 0 ||
    tableFilters.tagKeys.length > 0 ||
    tableFilters.transactionTypes.length > 0 ||
    tableFilters.needsReview;

  const { data: transactionsData, isLoading: isLoadingTransactions } =
    useAccountTransactions(
      {
        accountId: accountId,
        unreviewedOnly: showUnreviewedOnly || tableFilters.needsReview,
        fromDate: transactionDateRange?.from,
        toDate: transactionDateRange?.to,
        categoryKeys: tableFilters.categoryKeys,
        tagKeys: tableFilters.tagKeys,
        transactionTypes: tableFilters.transactionTypes,
      },
      {
        enabled: !!accountId && !Number.isNaN(accountId),
        // A table filter makes this a different query key, and the server payload
        // describes the *unfiltered* set. Seeding it would count as fresh for the global 60s
        // staleTime, so no fetch would fire and the filter would silently do nothing — the
        // same trap the all-accounts page's date range hit.
        ...serverSeed(
          hasTableFilters ? undefined : initialTransactionsData,
          serverRenderedAt,
        ),
      },
    );

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs(
    serverSeed(initialConfigsData, serverRenderedAt),
  );

  const { data: forecastData } = useAccountForecast(
    { accountKeys: [accountId], days: 30 },
    {
      enabled: !!accountId && !Number.isNaN(accountId),
      ...serverSeed(initialForecastData, serverRenderedAt),
    },
  );
  const accountForecast =
    forecastData?.accounts.find(
      (series) => series.accountKey === accountId,
    ) ?? null;

  const isLoading =
    isLoadingTransactions ||
    isLoadingConfigs ||
    isLoadingAccountsData ||
    isLoadingAccountsList;

  const accountName = accountsData?.account.accountName;

  const renderTransactionActions = ({
    addVariant,
  }: { addVariant?: "default" | "outline" } = {}) =>
    transactionAccount ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <AccountTransactionImportModal
          isOpen={isImportTransactionModalOpen}
          setOpen={(open) => {
            if (!open) {
              closeImportTransactionModal();
            } else {
              openImportTransactionModal();
            }
          }}
          accounts={[transactionAccount]}
          trigger={
            <Button variant="outline" className="w-full sm:w-auto">
              <Download className="size-4" />
              {t("import-transactions")}
            </Button>
          }
        />
        <AccountTransactionAddModal
          isOpen={isAddManualTransactionModalOpen}
          setOpen={(open) => {
            if (!open) {
              closeAddManualTransactionModal();
            } else {
              openAddManualTransactionModal();
            }
          }}
          accounts={[transactionAccount]}
          trigger={
            <Button
              {...(addVariant ? { variant: addVariant } : {})}
              className="w-full sm:w-auto"
            >
              <Plus className="size-4" />
              {t("add-transaction")}
            </Button>
          }
        />
      </div>
    ) : null;

  if (isLoading) {
    return <Spinner />;
  }

  const noTransactions =
    !isLoadingTransactions &&
    transactionsData?.transactions &&
    transactionsData.transactions.length === 0;
  const showTransactionsEmptyState =
    noTransactions &&
    !hasUsedDateFilter &&
    !showUnreviewedOnly &&
    !hasAnyTransactions;

  if (showTransactionsEmptyState) {
    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
              {t("transactions")}
            </h1>
            {accountName && (
              <p className="text-muted-foreground mt-0.5 text-sm">
                {accountName}
              </p>
            )}
          </div>
          {renderTransactionActions({ addVariant: "outline" })}
        </div>

        {/* Empty content */}
        <div className="border-border bg-card rounded-lg border px-6 py-16 text-center">
          <h2 className="text-foreground text-base font-medium">
            {t("empty-transactions")}
          </h2>
          <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
            {t("empty-transactions-description")}
          </p>
          <Button
            className="mt-4 gap-1.5"
            onClick={openAddManualTransactionModal}
          >
            <Plus className="size-3.5" />
            {t("add-transaction")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
            {t("transactions")}
          </h1>
          {accountName && (
            <p className="text-muted-foreground mt-0.5 text-sm">
              {accountName}
            </p>
          )}
        </div>
        {renderTransactionActions()}
      </div>

      {/* Transactions ledger, as on the all-accounts page */}
      <section aria-label={t("all-transactions")}>
        <div className="flex flex-col gap-4">
          <ProjectedTransactions
            occurrences={accountForecast?.projected ?? []}
            installments={accountForecast?.projectedInstallments ?? []}
          />
          <TransactionsTable
            layout="ledger"
            transactions={transactionsData?.transactions ?? []}
            categories={configsData?.categories ?? []}
            showUnreviewedOnly={showUnreviewedOnly}
            transactionDateRange={transactionDateRange}
            setTransactionDateRange={handleDateRangeChange}
            withAccountFilter={false}
            serverTotal={transactionsData?.total}
            onServerFiltersChange={handleTableFiltersChange}
          />
        </div>
      </section>
    </div>
  );
}
