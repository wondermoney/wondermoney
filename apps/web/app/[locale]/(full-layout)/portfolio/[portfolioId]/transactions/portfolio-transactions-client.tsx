"use client";

import { endOfDay, startOfDay, subDays } from "date-fns";
import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DateRange } from "react-day-picker";

import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import PortfolioTransactionImportModal from "@/components/portfolio/PortfolioTransactionImportModal";
import PortfolioTransactionsEmptyState from "@/components/portfolio/PortfolioTransactionsEmptyState";
import PortfolioTransactionsTable from "@/components/portfolio/PortfolioTransactionsTable";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import type { GetPortfolioTransactionsResponse } from "@/lib/api/portfolio/usePortfolioTransactions";
import usePortfolioTransactions from "@/lib/api/portfolio/usePortfolioTransactions";
import { createPortfolioImportHandoff } from "@/lib/portfolio/portfolio-modal-transition";
import { serverSeed } from "@/lib/query/server-seed";

interface PortfolioTransactionsClientProps {
  portfolioId: string;
  serverRenderedAt: number;
  initialPortfolioTransactionsData: GetPortfolioTransactionsResponse;
  hasAnyTransactions: boolean;
  defaultDateRange: { from: Date; to: Date };
  initialImportOpen?: boolean;
}

export default function PortfolioTransactionsClient({
  portfolioId,
  serverRenderedAt,
  initialPortfolioTransactionsData,
  hasAnyTransactions,
  defaultDateRange,
  initialImportOpen = false,
}: PortfolioTransactionsClientProps) {
  const t = useTranslations();

  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
  };

  const [isImportTransactionModalOpen, setImportTransactionModalOpen] =
    useState(initialImportOpen);

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
    serverSeed(initialPortfolioTransactionsData, serverRenderedAt),
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
          setOpen={setIsAddManualTransactionOpen}
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
          setOpen={setImportTransactionModalOpen}
          trigger={null}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2 sm:items-start">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
          {t("transactions")}
        </h1>
        <div className="flex items-center gap-2">
          <PortfolioTransactionAddModal
            isOpen={isAddManualTransactionModalOpen}
            setOpen={setIsAddManualTransactionOpen}
            trigger={
              <Button
                aria-label={t("add-transaction")}
                className="gap-2 max-sm:size-11 max-sm:p-0"
              >
                <Plus className="size-4" />

                <span className="sr-only sm:not-sr-only">
                  {t("add-transaction")}
                </span>
              </Button>
            }
            defaultPortfolioId={portfolioId}
            onImportTransactions={createPortfolioImportHandoff(
              setIsAddManualTransactionOpen,
              setImportTransactionModalOpen,
            )}
          />
          <PortfolioTransactionImportModal
            trigger={
              <Button
                variant="outline"
                aria-label={t("import-transactions")}
                title={t("import-transactions")}
                className="size-11 p-0 sm:h-10 sm:w-auto sm:px-4"
              >
                <Download className="size-4" />
                <span className="hidden sm:inline">
                  {t("import-transactions")}
                </span>
              </Button>
            }
            defaultPortfolioId={portfolioId}
            isOpen={isImportTransactionModalOpen}
            setOpen={setImportTransactionModalOpen}
          />
        </div>
      </div>
      <section className="min-w-0 space-y-3">
        <div className="border-border hidden border-b px-3 py-3 sm:block">
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
