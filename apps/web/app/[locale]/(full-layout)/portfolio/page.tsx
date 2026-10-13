"use client";

import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";

import TimeframeSelect from "@/components/dashboard/TimeframeSelect";
import PortfolioAllocationChart from "@/components/portfolio/PortfolioAllocationChart";
import PortfolioBenchmarkChart from "@/components/portfolio/PortfolioBenchmarkChart";
import PortfolioBreakdown from "@/components/portfolio/PortfolioBreakdown";
import PortfolioCalendar from "@/components/portfolio/PortfolioCalendar";
import PortfolioCreateDialog from "@/components/portfolio/PortfolioCreateDialog";
import PortfolioDashboardSummary from "@/components/portfolio/PortfolioDashboardSummary";
import PortfolioDividendIncome from "@/components/portfolio/PortfolioDividendIncome";
import PortfolioEmptyState from "@/components/portfolio/PortfolioEmptyState";
import PortfolioHoldingsTable from "@/components/portfolio/PortfolioHoldingsTable";
import PortfolioMetrics from "@/components/portfolio/PortfolioMetrics";
import PortfolioPerformanceChart from "@/components/portfolio/PortfolioPerformanceChart";
import PortfolioTopMovers from "@/components/portfolio/PortfolioTopMovers";
import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import PortfolioTransactionImportModal from "@/components/portfolio/PortfolioTransactionImportModal";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import useDividendIncome from "@/lib/api/portfolio/useDividendIncome";
import {
  type Period,
  useAggregateDashboard,
} from "@/lib/api/portfolio/usePortfolioDashboard";
import usePortfolioMetrics from "@/lib/api/portfolio/usePortfolioMetrics";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import usePortfoliosHoldings from "@/lib/api/portfolio/usePortfoliosHoldings";
import { useUser } from "@/lib/auth/user-context";
import { getDocsLink } from "@/lib/docs-links";
import {
  cancelFirstRunHandoff,
  completeFirstRunHandoff,
  getFirstRunStepRoute,
} from "@/lib/onboarding/firstRunOnboarding";
import { getPortfolioFromDate } from "@/lib/portfolio/portfolio-date-range";
import { createPortfolioImportHandoff } from "@/lib/portfolio/portfolio-modal-transition";

const Portfolio = () => {
  const t = useTranslations();
  const locale = useLocale();
  const posthog = usePostHog();
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const portfolioMetricsHref = getDocsLink("portfolioMetrics", locale);
  const TIMEFRAME_OPTIONS = [
    { label: t("timeframe-1m"), value: "1M" },
    { label: t("timeframe-3m"), value: "3M" },
    { label: t("timeframe-6m"), value: "6M" },
    { label: t("timeframe-ytd"), value: "YTD" },
    { label: t("timeframe-1y"), value: "1Y" },
    { label: t("timeframe-all"), value: "ALL" },
  ];

  const [period, setPeriod] = useState<Period>("YTD");

  const fromDate = useMemo(() => {
    return getPortfolioFromDate(period);
  }, [period]);

  const {
    data: portfoliosData,
    isError: isPortfoliosError,
    isLoading: isLoadingPortfoliosData,
  } = usePortfolios();
  const {
    data: dashboardData,
    isError: isDashboardError,
    isLoading: isLoadingDashboard,
  } = useAggregateDashboard(period);
  const { data: holdingsData, isLoading: isLoadingHoldings } =
    usePortfoliosHoldings();
  const { data: metricsData } = usePortfolioMetrics(fromDate);
  const { data: dividendData } = useDividendIncome(null);

  const [isCreatePortfolioModalOpen, setIsCreatePortfolioModalOpen] = useState(
    !!searchParams.get("create"),
  );
  const [isAddTransactionModalOpen, setIsAddTransactionModalOpen] =
    useState(false);
  const [isImportTransactionModalOpen, setIsImportTransactionModalOpen] =
    useState(false);
  const openPortfolioCreateModal = () => {
    setIsCreatePortfolioModalOpen(true);
    posthog.capture("portfolio_create_modal", { action: "open" });
  };
  const closePortfolioCreateModal = () => {
    setIsCreatePortfolioModalOpen(false);
    posthog.capture("portfolio_create_modal", { action: "close" });
  };

  const handleFirstRunPortfolioCreated = () => {
    const handled = completeFirstRunHandoff(
      "portfolio",
      {
        portfolioStep: "started",
        currentStep: "completion",
      },
      user?.id,
    );

    if (handled) {
      router.replace(getFirstRunStepRoute("completion"));
    }
  };

  const handleFirstRunPortfolioCancel = () => {
    if (cancelFirstRunHandoff("portfolio", "completion", user?.id)) {
      router.replace(getFirstRunStepRoute("completion"));
    }
  };

  if (isLoadingPortfoliosData || isLoadingDashboard) {
    return <Spinner />;
  }

  const hasPortfolios =
    !isLoadingPortfoliosData &&
    portfoliosData?.portfolios &&
    portfoliosData.portfolios.length > 0;

  if (!hasPortfolios) {
    return (
      <>
        <PortfolioEmptyState onCreatePortfolio={openPortfolioCreateModal} />
        <PortfolioCreateDialog
          isOpen={isCreatePortfolioModalOpen}
          setOpen={(open) => {
            if (!open) {
              closePortfolioCreateModal();
              handleFirstRunPortfolioCancel();
            } else {
              openPortfolioCreateModal();
            }
          }}
          showTrigger={false}
          onPortfolioCreated={handleFirstRunPortfolioCreated}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t("portfolios")}
            </h1>
            <HelpHint
              href={portfolioMetricsHref}
              className="rounded-full p-1 hover:no-underline [&_span]:sr-only [&_svg]:size-4"
            >
              {t("help-hint-portfolios")}
            </HelpHint>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t("portfolios-overview-description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <TimeframeSelect
            timeframes={TIMEFRAME_OPTIONS}
            timeframe={period}
            setTimeframe={(value) => setPeriod(value as Period)}
          />
          <div className="flex items-center gap-2">
            <PortfolioTransactionAddModal
              isOpen={isAddTransactionModalOpen}
              setOpen={setIsAddTransactionModalOpen}
              onImportTransactions={createPortfolioImportHandoff(
                setIsAddTransactionModalOpen,
                setIsImportTransactionModalOpen,
              )}
              trigger={
                <Button className="gap-2" size="sm">
                  <Plus className="size-4" />
                  {t("add-transaction")}
                </Button>
              }
            />
            <PortfolioCreateDialog
              isOpen={isCreatePortfolioModalOpen}
              setOpen={(open) => {
                if (!open) {
                  closePortfolioCreateModal();
                  handleFirstRunPortfolioCancel();
                } else {
                  openPortfolioCreateModal();
                }
              }}
              onPortfolioCreated={handleFirstRunPortfolioCreated}
            />
          </div>
        </div>
      </div>

      <PortfolioTransactionImportModal
        isOpen={isImportTransactionModalOpen}
        setOpen={setIsImportTransactionModalOpen}
        trigger={null}
      />

      {/* Summary */}
      {dashboardData?.summary && (
        <PortfolioDashboardSummary
          summary={dashboardData.summary}
          isAggregate
        />
      )}

      {/* Metrics */}
      {metricsData?.metrics ? (
        <PortfolioMetrics
          metrics={{
            ...metricsData.metrics,
            readiness:
              metricsData.metrics.readiness ?? metricsData.readiness?.metrics,
          }}
        />
      ) : (
        <div className="border-border bg-card rounded-lg border px-4 py-8 text-center">
          <p className="text-muted-foreground text-sm">
            {t("no-data-available")}
          </p>
        </div>
      )}

      {/* Performance */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("performance")}
          </h2>
        </div>
        <PortfolioPerformanceChart
          portfolioId={null}
          period={period}
          currency={dashboardData?.summary?.currency}
        />
      </section>

      {/* Allocation + Benchmark */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("allocation")}
            </h2>
          </div>
          <PortfolioAllocationChart
            portfolioId={null}
            currency={dashboardData?.summary?.currency ?? "USD"}
            showSectorToggle
          />
        </section>

        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("benchmark-comparison")}
            </h2>
          </div>
          <PortfolioBenchmarkChart portfolioId={null} period={period} />
        </section>
      </div>

      {/* Portfolios Breakdown */}
      {dashboardData?.portfolios && (
        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("portfolio-breakdown")}
            </h2>
          </div>
          <PortfolioBreakdown portfolios={dashboardData.portfolios} />
        </section>
      )}

      {/* Top Movers + Calendar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("top-movers")}
            </h2>
          </div>
          <PortfolioTopMovers
            portfolioId={null}
            period={period}
            currency={dashboardData?.summary?.currency}
          />
        </section>

        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("portfolio-calendar")}
            </h2>
          </div>
          <PortfolioCalendar holdings={holdingsData?.holdings} />
        </section>
      </div>

      {/* Dividend Income — only shown when at least one portfolio has dividends */}
      {dividendData && dividendData.totalDividends > 0 && (
        <section className="border-border bg-card rounded-lg border">
          <div className="border-border border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-medium">
              {t("dividend-income")}
            </h2>
          </div>
          <PortfolioDividendIncome
            portfolioId={null}
            currency={dashboardData?.summary?.currency}
          />
        </section>
      )}

      {/* Holdings */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("all-holdings")}
          </h2>
        </div>
        {isLoadingHoldings ? (
          <div className="flex h-25 items-center justify-center">
            <Spinner />
          </div>
        ) : holdingsData?.holdings && holdingsData.holdings.length > 0 ? (
          <PortfolioHoldingsTable transactions={holdingsData.holdings} />
        ) : (
          <div className="flex h-25 items-center justify-center">
            <p className="text-muted-foreground text-sm">{t("no-holdings")}</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default Portfolio;
