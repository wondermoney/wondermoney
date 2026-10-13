"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Settings } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PortfolioAllocationChart from "@/components/portfolio/PortfolioAllocationChart";
import PortfolioAllocationEmptyState from "@/components/portfolio/PortfolioAllocationEmptyState";
import PortfolioAllocationGuidance from "@/components/portfolio/PortfolioAllocationGuidance";
import PortfolioDashboardSummary from "@/components/portfolio/PortfolioDashboardSummary";
import PortfolioDividendIncome from "@/components/portfolio/PortfolioDividendIncome";
import PortfolioHistoryStatusBanner from "@/components/portfolio/PortfolioHistoryStatusBanner";
import PortfolioHoldingsTable from "@/components/portfolio/PortfolioHoldingsTable";
import PortfolioPerformanceChart from "@/components/portfolio/PortfolioPerformanceChart";
import PortfolioQuickStats from "@/components/portfolio/PortfolioQuickStats";
import PortfolioSettingsModal from "@/components/portfolio/PortfolioSettingsModal";
import PortfolioTargetAllocation from "@/components/portfolio/PortfolioTargetAllocation";
import PortfolioTargetAllocationEditor from "@/components/portfolio/PortfolioTargetAllocationEditor";
import PortfolioTopMovers from "@/components/portfolio/PortfolioTopMovers";
import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import PortfolioTransactionImportModal from "@/components/portfolio/PortfolioTransactionImportModal";
import PortfolioUnclassifiedHoldingsBanner from "@/components/portfolio/PortfolioUnclassifiedHoldingsBanner";
import { Button } from "@/components/ui/button";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import { Spinner } from "@/components/ui/Spinner";
import useDividendIncome from "@/lib/api/portfolio/useDividendIncome";
import type { GetPortfolioResponse } from "@/lib/api/portfolio/usePortfolio";
import usePortfolio from "@/lib/api/portfolio/usePortfolio";
import usePortfolioAllocation from "@/lib/api/portfolio/usePortfolioAllocation";
import {
  type Period,
  usePortfolioDashboard,
} from "@/lib/api/portfolio/usePortfolioDashboard";
import usePortfolioHistoryStatus from "@/lib/api/portfolio/usePortfolioHistoryStatus";
import usePortfolioHoldings from "@/lib/api/portfolio/usePortfolioHoldings";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";
import { getPortfolioImportTransactionsHref } from "@/lib/portfolio/portfolio-modal-transition";
import { invalidatePortfolioDetail } from "@/lib/utils/queryInvalidation";

interface PortfolioClientProps {
  portfolioId: number;
  initialPortfolioData: GetPortfolioResponse;
}

export default function PortfolioClient({
  portfolioId,
  initialPortfolioData,
}: PortfolioClientProps) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("YTD");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTargetEditorOpen, setIsTargetEditorOpen] = useState(false);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isImportTransactionOpen, setIsImportTransactionOpen] = useState(false);

  const { data: portfolioData, isLoading: isLoadingPortfolioData } =
    usePortfolio(portfolioId, {
      enabled: !!portfolioId,
      initialData: initialPortfolioData,
    });

  const { data: dashboardData, isLoading: isLoadingDashboard } =
    usePortfolioDashboard(portfolioId, period, {
      enabled: !!portfolioId,
    });

  const { data: allocationData } = usePortfolioAllocation(portfolioId);

  const updatePortfolio = useUpdatePortfolio();

  const handleApplyPreset = async (targets: Record<string, number>) => {
    try {
      await updatePortfolio.mutateAsync({
        portfolioId,
        targetAllocation: targets,
      });
      toast.success(t("save"));
    } catch {
      toast.error(t("server-error"));
    }
  };

  const { data: holdingsData, isLoading: isLoadingHoldings } =
    usePortfolioHoldings(String(portfolioId), {
      enabled: !!portfolioId,
    });

  const { data: dividendData } = useDividendIncome(portfolioId, {
    enabled: !!portfolioId,
  });

  const { data: historyStatus } = usePortfolioHistoryStatus(portfolioId, {
    enabled: !!portfolioId,
  });
  const previousHistoryStatusRef = useRef(historyStatus?.status);

  useEffect(() => {
    const previousStatus = previousHistoryStatusRef.current;
    const currentStatus = historyStatus?.status;

    if (
      previousStatus === "processing" &&
      currentStatus &&
      currentStatus !== "processing"
    ) {
      void invalidatePortfolioDetail(queryClient);
    }

    previousHistoryStatusRef.current = currentStatus;
  }, [historyStatus?.status, queryClient]);

  if (isLoadingPortfolioData || isLoadingDashboard) {
    return <Spinner />;
  }

  if (!portfolioData) {
    return <span>{t("portfolio-not-found")}</span>;
  }

  const hasNoHoldings =
    !isLoadingHoldings &&
    holdingsData?.holdings !== undefined &&
    holdingsData.holdings.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Same header shell as the account and goal detail pages, and a way back
          to the list this was reached from. No `value` is passed: the total
          leads the summary grid immediately below, and repeating it here is
          the duplication § 9 rule 5 exists to stop. The subtitle was
          "Portfolio dashboard" — the page's own name, already in the nav and
          the title, so it said nothing. */}
      <ObjectHeader
        backHref="/portfolio"
        backLabel={t("portfolio")}
        title={portfolioData.portfolio.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PortfolioTransactionAddModal
              isOpen={isAddTransactionOpen}
              setOpen={setIsAddTransactionOpen}
              defaultPortfolioId={String(portfolioId)}
              importHref={`/${locale}${getPortfolioImportTransactionsHref(String(portfolioId))}`}
              trigger={
                <Button className="gap-2" size="sm">
                  <Plus className="size-4" />
                  {t("add-transaction")}
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        }
      />

      {/* Settings Modal */}
      <PortfolioSettingsModal
        isOpen={isSettingsOpen}
        closeModal={() => setIsSettingsOpen(false)}
        portfolio={portfolioData.portfolio}
      />

      <PortfolioTransactionImportModal
        isOpen={isImportTransactionOpen}
        setOpen={setIsImportTransactionOpen}
        defaultPortfolioId={String(portfolioId)}
        trigger={null}
      />

      {/* Empty state when no transactions/holdings */}
      {hasNoHoldings && (
        <div className="border-border bg-card flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-20 text-center">
          <div className="flex flex-col items-center gap-2">
            <h2 className="text-foreground text-base font-semibold">
              {t("portfolio-empty-state-title")}
            </h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              {t("portfolio-empty-state-description")}
            </p>
          </div>
          <Button
            className="gap-2"
            onClick={() => setIsAddTransactionOpen(true)}
          >
            <Plus className="size-4" />
            {t("add-transaction")}
          </Button>
        </div>
      )}

      <PortfolioHistoryStatusBanner status={historyStatus} />

      {/* Dashboard content — hidden when no holdings yet */}
      {!hasNoHoldings && (
        <>
          {/* Summary */}
          {dashboardData?.summary && (
            <PortfolioDashboardSummary summary={dashboardData.summary} />
          )}

          {/* Performance + Allocation */}
          <section className="border-border bg-card rounded-lg border">
            <div className="border-border border-b px-5 py-3">
              <h2 className="text-foreground text-sm font-medium">
                {t("performance")}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-3">
              <div className="lg:border-border lg:col-span-2 lg:border-r">
                <PortfolioPerformanceChart
                  portfolioId={portfolioId}
                  period={period}
                  currency={dashboardData?.summary?.currency}
                />
              </div>
              <PortfolioAllocationChart
                portfolioId={portfolioId}
                currency={
                  dashboardData?.summary?.currency ??
                  portfolioData.portfolio.currencyKey.code
                }
                showSectorToggle
              />
            </div>
          </section>

          {/* Top Movers + Quick Stats */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="border-border bg-card rounded-lg border">
              <div className="border-border border-b px-5 py-3">
                <h2 className="text-foreground text-sm font-medium">
                  {t("top-movers")}
                </h2>
              </div>
              <PortfolioTopMovers
                portfolioId={portfolioId}
                period={period}
                currency={dashboardData?.summary?.currency}
              />
            </section>
            {dashboardData?.quickStats && (
              <section className="border-border bg-card rounded-lg border">
                <div className="border-border border-b px-5 py-3">
                  <h2 className="text-foreground text-sm font-medium">
                    {t("quick-stats")}
                  </h2>
                </div>
                <PortfolioQuickStats quickStats={dashboardData.quickStats} />
              </section>
            )}
          </div>

          {/* Target Allocation */}
          <PortfolioUnclassifiedHoldingsBanner
            holdings={allocationData?.unclassifiedHoldings}
          />

          {portfolioData?.portfolio.targetAllocation ? (
            <section className="border-border bg-card rounded-lg border">
              <div className="border-border flex items-center justify-between border-b px-5 py-3">
                <h2 className="text-foreground text-sm font-medium">
                  {t("target-allocation")}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsTargetEditorOpen(true)}
                >
                  {t("edit")}
                </Button>
              </div>
              <PortfolioTargetAllocation
                driftRows={allocationData?.driftRows}
              />
              <PortfolioAllocationGuidance
                guidanceText={allocationData?.guidanceText}
              />
            </section>
          ) : (
            allocationData?.byAssetClass &&
            allocationData.byAssetClass.length > 0 && (
              <PortfolioAllocationEmptyState
                onApplyPreset={handleApplyPreset}
                onCustomize={() => setIsTargetEditorOpen(true)}
              />
            )
          )}

          <PortfolioTargetAllocationEditor
            isOpen={isTargetEditorOpen}
            closeModal={() => setIsTargetEditorOpen(false)}
            portfolioId={portfolioId}
            currentAssetClasses={(allocationData?.byAssetClass ?? []).map(
              (a) => a.type,
            )}
            currentTargets={portfolioData?.portfolio.targetAllocation}
          />

          {/* Dividend Income — only shown when portfolio has dividends */}
          {dividendData && dividendData.totalDividends > 0 && (
            <section className="border-border bg-card rounded-lg border">
              <div className="border-border border-b px-5 py-3">
                <h2 className="text-foreground text-sm font-medium">
                  {t("dividend-income")}
                </h2>
              </div>
              <PortfolioDividendIncome
                portfolioId={portfolioId}
                currency={dashboardData?.summary?.currency}
              />
            </section>
          )}

          {/* Holdings */}
          <section className="border-border bg-card rounded-lg border">
            <div className="border-border border-b px-5 py-3">
              <h2 className="text-foreground text-sm font-medium">
                {t("holdings")}
              </h2>
            </div>
            {isLoadingHoldings ? (
              <div className="flex h-[100px] items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <PortfolioHoldingsTable
                transactions={holdingsData?.holdings ?? []}
                portfolioId={String(portfolioId)}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
