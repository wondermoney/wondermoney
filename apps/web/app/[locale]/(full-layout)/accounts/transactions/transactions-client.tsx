"use client";

import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useState } from "react";
import { DateRange } from "react-day-picker";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import AccountsFreshness from "@/components/account/AccountsFreshness";
import AccountsTransactionsEmptyState from "@/components/account/AccountsTransactionsEmptyState";
import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import TransactionsTable from "@/components/account/AccountTransactionsTable";
import { AccountsTransactionsOnboarding } from "@/components/onboarding/AccountsTransactionsOnboarding";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetTransactionsResponse } from "@/lib/api/account/useTransactions";
import { useInfiniteTransactions } from "@/lib/api/account/useTransactions";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";
import { serverSeed } from "@/lib/query/server-seed";

interface AccountsTransactionsClientProps {
  serverRenderedAt: number;
  initialAccountsData: GetAccountsResponse;
  initialTransactionsData: GetTransactionsResponse;
  initialConfigsData: GetConfigsResponse;
  defaultDateRange: { from: Date; to: Date };
}

export default function AccountsTransactionsClient({
  serverRenderedAt,
  initialAccountsData,
  initialTransactionsData,
  initialConfigsData,
  defaultDateRange,
}: AccountsTransactionsClientProps) {
  const t = useTranslations();
  const posthog = usePostHog();

  // Add account modal (when no transactions)
  const [accountAddModalIsOpen, setAccountAddModalIsOpen] = useState(false);
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] =
    useState(false);
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(false);
  const onAddSyncAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddSyncModalIsOpen(true);
    posthog.capture("account_add_sync_modal", { action: "open" });
  };
  const closeAccountAddSyncModal = () => {
    setAccountAddSyncModalIsOpen(false);
    posthog.capture("account_add_sync_modal", { action: "close" });
  };
  const onAddOfflineAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddOfflineModalIsOpen(true);
    posthog.capture("account_add_offline_modal", { action: "open" });
  };
  const closeAccountAddOfflineModal = () => {
    setAccountAddOfflineModalIsOpen(false);
    posthog.capture("account_add_offline_modal", { action: "close" });
  };

  // Add manual transaction modal
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

  // Import transaction modal
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

  // Table stuff
  const [hasUsedDateFilter, setHasUsedDateFilter] = useState(false);
  const [transactionDateRange, setTransactionDateRange] = useState<
    DateRange | undefined
  >({ from: defaultDateRange.from, to: defaultDateRange.to });
  const handleDateRangeChange = (dateRange?: DateRange) => {
    setTransactionDateRange(dateRange);
    setHasUsedDateFilter(true);
  };

  const [showHiddenTransactions, setShowHiddenTransactions] = useState(false);

  // True only while the visible query matches what the server rendered.
  const isServerRenderedQuery =
    !showHiddenTransactions &&
    transactionDateRange?.from?.getTime() === defaultDateRange.from.getTime() &&
    transactionDateRange?.to?.getTime() === defaultDateRange.to.getTime();

  const { data: accountsData, isLoading: isLoadingAccountsData } = useAccounts(
    serverSeed(initialAccountsData, serverRenderedAt),
  );

  /*
   * The table's own filters, lifted so they reach the endpoint.
   *
   * Filtering only the loaded rows would mean filtering a year by one category only filtered
   * whichever page had come back. The table owns the filter *UI* and its state; it reports
   * changes up here, and this is what turns them into a refetch.
   */
  const [tableFilters, setTableFilters] = useState<{
    accountKeys: string[];
    categoryKeys: string[];
    needsReview: boolean;
    transactionTypes: string[];
  }>({
    accountKeys: [],
    categoryKeys: [],
    needsReview: false,
    transactionTypes: [],
  });

  const handleTableFiltersChange = useCallback(
    (next: {
      accountKeys: string[];
      categoryKeys: string[];
      needsReview: boolean;
      transactionTypes: string[];
    }) => {
      // The table re-reports on every render of its effect, so bail when nothing moved —
      // otherwise this setState loops and the query key churns.
      setTableFilters((current) =>
        current.needsReview === next.needsReview &&
        current.accountKeys.join() === next.accountKeys.join() &&
        current.categoryKeys.join() === next.categoryKeys.join() &&
        current.transactionTypes.join() === next.transactionTypes.join()
          ? current
          : next,
      );
    },
    [],
  );

  // Any active table filter makes this a different query from the one the server rendered.
  const hasTableFilters =
    tableFilters.accountKeys.length > 0 ||
    tableFilters.categoryKeys.length > 0 ||
    tableFilters.transactionTypes.length > 0 ||
    tableFilters.needsReview;

  const {
    data: transactionsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingTransactions,
  } = useInfiniteTransactions(
    {
      fromDate: transactionDateRange?.from,
      toDate: transactionDateRange?.to,
      includeHidden: showHiddenTransactions,
      accountKeys: tableFilters.accountKeys,
      categoryKeys: tableFilters.categoryKeys,
      transactionTypes: tableFilters.transactionTypes,
      ...(tableFilters.needsReview ? { unreviewedOnly: true } : {}),
    },
    {
      enabled: accountsData?.accounts && accountsData.accounts.length > 0,
      // Only seed the query key the server actually rendered.
      //
      // `initialData` applies to whatever key is current, and changing the
      // date range makes a *new* key. Passed unconditionally, every range
      // the user picked was seeded with the server payload for the
      // **default** range — and because the global `staleTime` is 60s, that
      // stale seed counted as fresh, so no fetch fired. Changing the date
      // filter silently did nothing for a minute.
      // A table filter makes this a different query too, so it must not be seeded
      // with the server's unfiltered payload — the same trap the date range fell into.
      ...serverSeed(
        isServerRenderedQuery && !hasTableFilters
          ? initialTransactionsData
          : undefined,
        serverRenderedAt,
      ),
    },
  );

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs(
    serverSeed(initialConfigsData, serverRenderedAt),
  );

  const isLoading =
    isLoadingAccountsData || isLoadingTransactions || isLoadingConfigs;

  const noAccounts =
    !isLoadingAccountsData &&
    accountsData?.accounts &&
    accountsData.accounts.length === 0;

  const noTransactions =
    !isLoadingTransactions &&
    transactionsData?.transactions &&
    transactionsData.transactions.length === 0;

  // Only show empty state for transactions if user hasn't filtered by date
  const showTransactionsEmptyState = noTransactions && !hasUsedDateFilter;

  if (isLoading) {
    return <Spinner />;
  }

  // No accounts empty state
  if (noAccounts) {
    return (
      <>
        <AccountsTransactionsEmptyState
          onAddAccount={() => setAccountAddModalIsOpen(true)}
          onAddTransaction={openAddManualTransactionModal}
          noAccounts
        />
        <AccountAddModal
          isOpen={accountAddModalIsOpen}
          setOpen={setAccountAddModalIsOpen}
          onAddSyncAccountClick={onAddSyncAccountClick}
          onAddOfflineAccountClick={onAddOfflineAccountClick}
          trigger={false}
        />
        <AccountAddSyncModal
          isOpen={accountAddSyncModalIsOpen}
          setOpen={closeAccountAddSyncModal}
        />
        <AccountAddOfflineModal
          isOpen={accountAddOfflineModalIsOpen}
          closeModal={closeAccountAddOfflineModal}
        />
      </>
    );
  }

  // No transactions empty state (first-time, hasn't used date filter)
  if (showTransactionsEmptyState) {
    return (
      <>
        <AccountsTransactionsEmptyState
          onAddAccount={() => setAccountAddModalIsOpen(true)}
          onAddTransaction={openAddManualTransactionModal}
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
          accounts={accountsData?.accounts ?? []}
          trigger={null}
        />
        <AccountTransactionImportModal
          isOpen={isImportTransactionModalOpen}
          setOpen={(open) => {
            if (!open) {
              closeImportTransactionModal();
            } else {
              openImportTransactionModal();
            }
          }}
          accounts={accountsData?.accounts ?? []}
          trigger={null}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {/* § 9 rule 3: a declarative header — the title and nothing else.
                No supporting sentence; the table starts immediately. */}
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t("transactions")}
            </h1>
            <AccountsTransactionsOnboarding />
          </div>
          {/* § 9 rule 6: say how fresh this is. A missing charge otherwise looks
              exactly like a quiet spending day. */}
          <AccountsFreshness accounts={accountsData?.accounts} />
        </div>
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
            accounts={accountsData?.accounts ?? []}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 sm:w-auto"
              >
                <Download className="size-3.5" />
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
            accounts={accountsData?.accounts ?? []}
            trigger={
              <Button size="sm" className="w-full gap-1.5 sm:w-auto">
                <Plus className="size-3.5" />
                {t("add-transaction")}
              </Button>
            }
          />
        </div>
      </div>

      {/* Transactions table */}
      <TransactionsTable
        transactions={transactionsData?.transactions ?? []}
        serverTotal={transactionsData?.total}
        footerActions={
          // Only rendered when the server says there is another page, so it
          // cannot appear on a fully-loaded list and promise nothing.
          hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? t("loading") : t("load-more")}
            </Button>
          ) : undefined
        }
        onServerFiltersChange={handleTableFiltersChange}
        categories={configsData?.categories ?? []}
        transactionDateRange={transactionDateRange}
        setTransactionDateRange={handleDateRangeChange}
        showHiddenTransactions={showHiddenTransactions}
        onShowHiddenTransactionsChange={setShowHiddenTransactions}
        withSelectRow
        withMultiSelectRow
      />
    </div>
  );
}
