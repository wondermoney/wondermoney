"use client";

import { endOfDay, startOfDay, subDays } from "date-fns";
import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DateRange } from "react-day-picker";

import PortfolioCreateDialog from "@/components/portfolio/PortfolioCreateDialog";
import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import PortfolioTransactionImportModal from "@/components/portfolio/PortfolioTransactionImportModal";
import PortfolioTransactionsEmptyState from "@/components/portfolio/PortfolioTransactionsEmptyState";
import PortfolioTransactionsTable from "@/components/portfolio/PortfolioTransactionsTable";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import type { GetPortfoliosResponse } from "@/lib/api/portfolio/usePortfolios";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import type { GetPortfoliosTransactionsResponse } from "@/lib/api/portfolio/usePortfoliosTransactions";
import usePortfoliosTransactions from "@/lib/api/portfolio/usePortfoliosTransactions";
import { serverSeed } from "@/lib/query/server-seed";

interface PortfolioTransactionsClientProps {
  serverRenderedAt: number;
  initialPortfoliosData: GetPortfoliosResponse;
  initialPortfoliosTransactionsData: GetPortfoliosTransactionsResponse;
  hasAnyTransactions: boolean;
  defaultDateRange: { from: Date; to: Date };
}

export default function PortfolioTransactionsClient({
  serverRenderedAt,
  initialPortfoliosData,
  initialPortfoliosTransactionsData,
  hasAnyTransactions,
  defaultDateRange,
}: PortfolioTransactionsClientProps) {
  const t = useTranslations();

  // Add portfolio modal
  const [isCreatePortfolioModalOpen, setIsCreatePortfolioModalOpen] =
    useState(false);
  const openPortfolioCreateModal = () => {
    setIsCreatePortfolioModalOpen(true);
  };

  // Import transaction modal
  const [isImportTransactionModalOpen, setImportTransactionModalOpen] =
    useState(false);

  // Add manual transaction modal
  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
  };

  // Track newly created portfolio to auto-select in transaction modal
  const [lastCreatedPortfolioId, setLastCreatedPortfolioId] = useState<
    string | undefined
  >();

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

  const { data: portfoliosData, isLoading: isLoadingPortfoliosData } =
    usePortfolios(serverSeed(initialPortfoliosData, serverRenderedAt));

  const {
    data: portfoliosTransactionsData,
    isLoading: isLoadingPortfoliosTransactions,
  } = usePortfoliosTransactions(
    { fromDate: transactionDateRange?.from, toDate: transactionDateRange?.to },
    {
      enabled:
        portfoliosData?.portfolios && portfoliosData.portfolios.length > 0,
      // Only seed with the SSR-fetched data for the default range. Once the
      // user picks a different range, initialData must not be passed —
      // otherwise React Query treats the new query key as fresh (per the
      // global staleTime) and never fires the actual fetch for it.
      ...serverSeed(
        hasUsedDateFilter ? undefined : initialPortfoliosTransactionsData,
        serverRenderedAt,
      ),
    },
  );

  const isLoading = isLoadingPortfoliosData || isLoadingPortfoliosTransactions;

  const noPortfolios =
    !isLoadingPortfoliosData &&
    portfoliosData?.portfolios &&
    portfoliosData.portfolios.length === 0;

  const noTransactions =
    !isLoadingPortfoliosTransactions &&
    portfoliosTransactionsData?.transactions &&
    portfoliosTransactionsData.transactions.length === 0;
  const showTransactionsEmptyState =
    noTransactions && !hasUsedDateFilter && !hasAnyTransactions;

  if (isLoading) {
    return <Spinner />;
  }

  if (noPortfolios) {
    return (
      <>
        <PortfolioTransactionsEmptyState
          onAddTransaction={openPortfolioCreateModal}
          noPortfolios
        />
        <PortfolioCreateDialog
          isOpen={isCreatePortfolioModalOpen}
          setOpen={setIsCreatePortfolioModalOpen}
          showTrigger={false}
          onPortfolioCreated={(portfolioKey) => {
            setLastCreatedPortfolioId(portfolioKey.toString());
            openAddManualTransactionModal();
          }}
        />
        <PortfolioTransactionAddModal
          isOpen={isAddManualTransactionModalOpen}
          setOpen={setIsAddManualTransactionOpen}
          defaultPortfolioId={lastCreatedPortfolioId}
          trigger={null}
        />
      </>
    );
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
          defaultPortfolioId={lastCreatedPortfolioId}
          trigger={null}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:items-start">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
          {t("transactions")}
        </h1>
        <div className="flex items-center gap-2">
          <PortfolioTransactionImportModal
            isOpen={isImportTransactionModalOpen}
            setOpen={setImportTransactionModalOpen}
            defaultPortfolioId={portfoliosData?.portfolios[0].portfolioKey.toString()}
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
          />
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
          />
        </div>
      </div>
      <PortfolioTransactionsTable
        transactions={portfoliosTransactionsData?.transactions ?? []}
        transactionDateRange={transactionDateRange}
        setTransactionDateRange={handleDateRangeChange}
      />
    </div>
  );
}
