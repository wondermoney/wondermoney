"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";

import TimeframeSelect from "@/components/dashboard/TimeframeSelect";
import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import PortfolioAllocationChart from "@/components/portfolio/PortfolioAllocationChart";
import PortfolioBenchmarkChart from "@/components/portfolio/PortfolioBenchmarkChart";
import PortfolioBreakdown from "@/components/portfolio/PortfolioBreakdown";
import PortfolioCalendar from "@/components/portfolio/PortfolioCalendar";
import PortfolioClosedPositions from "@/components/portfolio/PortfolioClosedPositions";
import PortfolioCreateDialog from "@/components/portfolio/PortfolioCreateDialog";
import PortfolioDashboardSummary from "@/components/portfolio/PortfolioDashboardSummary";
import PortfolioDividendIncome from "@/components/portfolio/PortfolioDividendIncome";
import PortfolioEmptyState from "@/components/portfolio/PortfolioEmptyState";
import PortfolioHoldingsTable from "@/components/portfolio/PortfolioHoldingsTable";
import PortfolioMetrics from "@/components/portfolio/PortfolioMetrics";
import PortfolioPerformanceChart from "@/components/portfolio/PortfolioPerformanceChart";
import PortfolioRealizedGains from "@/components/portfolio/PortfolioRealizedGains";
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
import { useMemberFilter } from "@/lib/household/useMemberFilter";
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
  // One member filter (`?member=`, `lib/household/member-attribution.ts`) for
  // the whole overview: every section keeps the portfolios that member owns,
  // and a former member's under Shared. Absent (everyone, or a household of
  // one), every read is the household's as before.
  const { memberKeys } = useMemberFilter();

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
  } = useAggregateDashboard(
    period,
    // Changing the period or the member keeps the page (and its controls) on
    // screen with the last figures until the new ones arrive.
    { placeholderData: keepPreviousData },
    memberKeys,
  );
  const { data: holdingsData, isLoading: isLoadingHoldings } =
    usePortfoliosHoldings(undefined, memberKeys);
  const { data: metricsData } = usePortfolioMetrics(
    fromDate,
    undefined,
    memberKeys,
  );
  const { data: dividendData } = useDividendIncome(null, undefined, memberKeys);

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
    <div className="flex flex-col gap-10 lg:gap-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
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
          <MemberFilterControl className="w-40 sm:w-44" />
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
                <Button>
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
        <div className="py-4">
          <p className="text-muted-foreground text-sm">
            {t("no-data-available")}
          </p>
        </div>
      )}

      {/* Performance */}
      <section className="border-foreground min-w-0 border-t-2 pt-4">
        <div className="mb-4">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            {t("performance")}
          </h2>
        </div>
        <PortfolioPerformanceChart
          portfolioId={null}
          period={period}
          currency={dashboardData?.summary?.currency}
          memberKeys={memberKeys}
        />
      </section>

      {/* Allocation + Benchmark */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-12">
        <section className="border-foreground min-w-0 border-t-2 pt-4">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              {t("allocation")}
            </h2>
          </div>
          <PortfolioAllocationChart
            portfolioId={null}
            currency={dashboardData?.summary?.currency ?? "USD"}
            showSectorToggle
            memberKeys={memberKeys}
          />
        </section>

        <section className="border-foreground min-w-0 border-t-2 pt-4">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              {t("benchmark-comparison")}
            </h2>
          </div>
          <PortfolioBenchmarkChart
            portfolioId={null}
            period={period}
            memberKeys={memberKeys}
          />
        </section>
      </div>

      {/* Portfolios Breakdown */}
      {dashboardData?.portfolios && (
        <section className="border-foreground min-w-0 border-t-2 pt-4">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              {t("portfolio-breakdown")}
            </h2>
          </div>
          <PortfolioBreakdown portfolios={dashboardData.portfolios} />
        </section>
      )}

      {/* Top Movers + Calendar */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-12">
        <section className="border-foreground min-w-0 border-t-2 pt-4">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              {t("top-movers")}
            </h2>
          </div>
          <PortfolioTopMovers
            portfolioId={null}
            period={period}
            currency={dashboardData?.summary?.currency}
            memberKeys={memberKeys}
          />
        </section>

        <section className="border-foreground min-w-0 border-t-2 pt-4">
          <div className="mb-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              {t("portfolio-calendar")}
            </h2>
          </div>
          <PortfolioCalendar
            holdings={holdingsData?.holdings}
            memberKeys={memberKeys}
          />
        </section>
      </div>

      {/* Dividend Income — only shown when at least one portfolio has dividends */}
      {dividendData &&
        (dividendData.totalDividends > 0 ||
          dividendData.completeness?.isComplete === false) && (
          <section className="border-foreground min-w-0 border-t-2 pt-4">
            <div className="mb-4">
              <h2 className="text-foreground text-lg font-semibold tracking-tight">
                {t("dividend-income")}
              </h2>
            </div>
            <PortfolioDividendIncome
              portfolioId={null}
              currency={dashboardData?.summary?.currency}
              memberKeys={memberKeys}
            />
          </section>
        )}

      {/* Holdings */}
      <section className="border-foreground min-w-0 border-t-2 pt-4">
        <div className="mb-4">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
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

      {/* Each renders nothing until a portfolio has a sale. */}
      <PortfolioRealizedGains portfolioId={null} memberKeys={memberKeys} />
      <PortfolioClosedPositions portfolioId={null} memberKeys={memberKeys} />
    </div>
  );
};

export default Portfolio;
