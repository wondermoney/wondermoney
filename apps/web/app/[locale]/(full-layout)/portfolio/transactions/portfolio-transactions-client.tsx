"use client";

import { endOfDay, startOfDay, subDays } from "date-fns";
import { Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
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
  const posthog = usePostHog();

  // Add portfolio modal
  const [isCreatePortfolioModalOpen, setIsCreatePortfolioModalOpen] =
    useState(false);
  const openPortfolioCreateModal = () => {
    setIsCreatePortfolioModalOpen(true);
    posthog.capture("portfolio_create_modal", { action: "open" });
  };
  const closePortfolioCreateModal = () => {
    setIsCreatePortfolioModalOpen(false);
    posthog.capture("portfolio_create_modal", { action: "close" });
  };

  // Import transaction modal
  const [isImportTransactionModalOpen, setImportTransactionModalOpen] =
    useState(false);
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

  // Add manual transaction modal
  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
    posthog.capture("portfolio_transaction_add_manual_transaction", {
      action: "open",
    });
  };
  const closeAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(false);
    posthog.capture("portfolio_transaction_add_manual_transaction", {
      action: "close",
    });
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
          setOpen={(open) => {
            if (!open) {
              closePortfolioCreateModal();
            } else {
              openPortfolioCreateModal();
            }
          }}
          showTrigger={false}
          onPortfolioCreated={(portfolioKey) => {
            setLastCreatedPortfolioId(portfolioKey.toString());
            openAddManualTransactionModal();
          }}
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
          setOpen={(open) => {
            if (!open) {
              closeAddManualTransactionModal();
            } else {
              openAddManualTransactionModal();
            }
          }}
          defaultPortfolioId={lastCreatedPortfolioId}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <PortfolioTransactionImportModal
            isOpen={isImportTransactionModalOpen}
            setOpen={(open) => {
              if (!open) {
                closeImportTransactionModal();
              } else {
                openImportTransactionModal();
              }
            }}
            defaultPortfolioId={portfoliosData?.portfolios[0].portfolioKey.toString()}
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
          <PortfolioTransactionAddModal
            isOpen={isAddManualTransactionModalOpen}
            setOpen={(open) => {
              if (!open) {
                closeAddManualTransactionModal();
              } else {
                openAddManualTransactionModal();
              }
            }}
            trigger={
              <Button size="sm" className="w-full gap-1.5 sm:w-auto">
                <Plus className="size-3.5" />
                {t("add-transaction")}
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
