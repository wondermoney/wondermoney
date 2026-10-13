"use client";

import { endOfDay, startOfDay, subDays } from "date-fns";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { DateRange } from "react-day-picker";

import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import PortfolioTransactionImportModal from "@/components/portfolio/PortfolioTransactionImportModal";
import PortfolioTransactionsEmptyState from "@/components/portfolio/PortfolioTransactionsEmptyState";
import PortfolioTransactionsTable from "@/components/portfolio/PortfolioTransactionsTable";
import { Spinner } from "@/components/ui/Spinner";
import type { GetPortfolioTransactionsResponse } from "@/lib/api/portfolio/usePortfolioTransactions";
import usePortfolioTransactions from "@/lib/api/portfolio/usePortfolioTransactions";
import { createPortfolioImportHandoff } from "@/lib/portfolio/portfolio-modal-transition";

interface PortfolioTransactionsClientProps {
  portfolioId: string;
  initialPortfolioTransactionsData: GetPortfolioTransactionsResponse;
  hasAnyTransactions: boolean;
  defaultDateRange: { from: Date; to: Date };
  initialImportOpen?: boolean;
}

export default function PortfolioTransactionsClient({
  portfolioId,
  initialPortfolioTransactionsData,
  hasAnyTransactions,
  defaultDateRange,
  initialImportOpen = false,
}: PortfolioTransactionsClientProps) {
  const t = useTranslations();
  const posthog = usePostHog();

  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
    posthog.capture("portfolio_transaction_table_add_manual_transaction", {
      action: "open",
    });
  };
  const closeAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(false);
    posthog.capture("portfolio_transaction_table_add_manual_transaction", {
      action: "close",
    });
  };

  const [isImportTransactionModalOpen, setImportTransactionModalOpen] =
    useState(initialImportOpen);
  const openImportTransactionModal = () => {
    setImportTransactionModalOpen(true);
    posthog.capture("portfolio_transaction_table_import_transaction", {
      action: "open",
    });
  };
  const closeImportTransactionModal = () => {
    setImportTransactionModalOpen(false);
    posthog.capture("portfolio_transaction_table_import_transaction", {
      action: "close",
    });
  };

  // Table stuff
  // We track this to distinguish between the user filtering the table and the initial load
  const [hasUsedDateFilter, setHasUsedDateFilter] = useState(false);
  const [transactionDateRange, setTransactionDateRange] = useState<
    DateRange | undefined
  >({ from: defaultDateRange.from, to: defaultDateRange.to });
  const handleDateRangeChange = (dateRange?: DateRange) => {
    setTransactionDateRange(dateRange);
    setHasUsedDateFilter(true);
  };

  const {
    data: portfolioTransactionsData,
    isLoading: isLoadingPortfolioTransactions,
  } = usePortfolioTransactions(
    {
      portfolioId: portfolioId,
      fromDate: transactionDateRange?.from,
      toDate: transactionDateRange?.to,
    },
    { initialData: initialPortfolioTransactionsData },
  );

  const noTransactions =
    !isLoadingPortfolioTransactions &&
    portfolioTransactionsData?.transactions &&
    portfolioTransactionsData.transactions.length === 0;
  const showTransactionsEmptyState =
    noTransactions && !hasUsedDateFilter && !hasAnyTransactions;

  if (isLoadingPortfolioTransactions || !portfolioTransactionsData) {
    return <Spinner />;
  }

  if (showTransactionsEmptyState) {
    return (
      <>
        <PortfolioTransactionsEmptyState
          onAddTransaction={openAddManualTransactionModal}
        />
        <PortfolioTransactionAddModal
          isOpen={isAddManualTransactionModalOpen}
          setOpen={(open) => {
            if (!open) {
              closeAddManualTransactionModal();
            } else {
              openAddManualTransactionModal();
            }
          }}
          defaultPortfolioId={portfolioId}
          onImportTransactions={createPortfolioImportHandoff(
            setIsAddManualTransactionOpen,
            setImportTransactionModalOpen,
          )}
          trigger={null}
        />
        <PortfolioTransactionImportModal
          defaultPortfolioId={portfolioId}
          isOpen={isImportTransactionModalOpen}
          setOpen={(open) => {
            if (!open) {
              closeImportTransactionModal();
            } else {
              openImportTransactionModal();
            }
          }}
          trigger={null}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t("transactions")}
        </h1>
        <div className="flex items-center gap-2">
          <PortfolioTransactionAddModal
            isOpen={isAddManualTransactionModalOpen}
            setOpen={(open) => {
              if (!open) {
                closeAddManualTransactionModal();
              } else {
                openAddManualTransactionModal();
              }
            }}
            defaultPortfolioId={portfolioId}
            onImportTransactions={createPortfolioImportHandoff(
              setIsAddManualTransactionOpen,
              setImportTransactionModalOpen,
            )}
          />
          <PortfolioTransactionImportModal
            defaultPortfolioId={portfolioId}
            isOpen={isImportTransactionModalOpen}
            setOpen={(open) => {
              if (!open) {
                closeImportTransactionModal();
              } else {
                openImportTransactionModal();
              }
            }}
          />
        </div>
      </div>
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("all-transactions")}
          </h2>
        </div>
        <PortfolioTransactionsTable
          transactions={portfolioTransactionsData.transactions}
          withPortfolioFilter={false}
          transactionDateRange={transactionDateRange}
          setTransactionDateRange={handleDateRangeChange}
        />
      </section>
    </div>
  );
}
