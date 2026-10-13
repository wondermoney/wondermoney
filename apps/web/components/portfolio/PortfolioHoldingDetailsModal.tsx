"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import type { PortfolioTransaction } from "@/lib/api/portfolio/portfolioTransactionTypes";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import usePortfoliosTransactions from "@/lib/api/portfolio/usePortfoliosTransactions";
import usePortfolioTransactions from "@/lib/api/portfolio/usePortfolioTransactions";
import {
  buildHoldingActivitySummary,
  buildHoldingPositionSummary,
} from "@/lib/portfolio/holding-detail-summary";

import CompanyInfo from "../financial-market/FinancialMarketsTickerInfo";
import FinancialMarketsTickerPrice from "../financial-market/FinancialMarketsTickerPrice";
import { CertificadoAforroAccrualPanel } from "./CertificadoAforroAccrualPanel";
import { HoldingActivitySummary } from "./HoldingActivitySummary";
import HoldingAnalystRatings from "./HoldingAnalystRatings";
import { HoldingPositionHeader } from "./HoldingPositionHeader";
import { HoldingPositionMetrics } from "./HoldingPositionMetrics";
import HoldingValuationMetrics from "./HoldingValuationMetrics";
import PortfolioTransactionsTable from "./PortfolioTransactionsTable";

interface PortfolioHoldingDetailsModalProps {
  isOpen: boolean;
  closeModal: () => void;
  holding: PortfolioHolding | null;
  portfolioId?: string;
}

// Static-mode Certificado de Aforro series (Séries A/B) — legacy, perpetual,
// fixed-face-value certificates with no accrual data. Keep this in sync with
// the "static" valuationMode entries in CA_SERIES_OPTIONS
// (CertificadoAforroSeriesPicker.tsx).
const STATIC_MODE_SYMBOLS = ["CA-SERIE-A", "CA-SERIE-B"];

function TickerDataFallback({ ticker }: { ticker: string }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border p-6 text-center">
      <Text className="font-semibold">{ticker}</Text>
      <Text variant="smallText" className="text-muted-foreground">
        {t("market-data-unavailable")}
      </Text>
    </div>
  );
}

function UnavailableState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
      <Text variant="smallText" className="text-muted-foreground">
        {message}
      </Text>
    </div>
  );
}

class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const PortfolioHoldingDetailsModal: React.FC<
  PortfolioHoldingDetailsModalProps
> = ({ isOpen, closeModal, holding, portfolioId }) => {
  const t = useTranslations();
  const ticker = holding?.financialAssetSymbol;
  const portfolioTransactionsQuery = usePortfolioTransactions(
    { portfolioId: portfolioId ?? "" },
    {
      enabled: isOpen && Boolean(portfolioId) && Boolean(ticker),
    },
  );
  const portfoliosTransactionsQuery = usePortfoliosTransactions(
    ticker ? { ticker } : undefined,
    {
      enabled: isOpen && !portfolioId && Boolean(ticker),
    },
  );
  const transactionsQuery = portfolioId
    ? portfolioTransactionsQuery
    : portfoliosTransactionsQuery;
  const portfoliosData = transactionsQuery.data;
  const isTransactionsError = transactionsQuery.isError;
  const isTransactionsLoading = transactionsQuery.isLoading;
  const positionSummary =
    holding && ticker ? buildHoldingPositionSummary(holding) : null;
  const isHoldingTransactionForTicker = React.useCallback(
    (transaction: PortfolioTransaction) =>
      transaction.financialAssetKey.symbol === ticker,
    [ticker],
  );
  const isSavingsCertificate =
    positionSummary?.type.toLowerCase() === "savings certificate";
  const isStaticModeCertificate = STATIC_MODE_SYMBOLS.includes(ticker ?? "");
  const hasMarketData = Boolean(
    positionSummary &&
    ticker &&
    !ticker.startsWith("CURRENCY_") &&
    positionSummary.type.toLowerCase() !== "cash" &&
    !isSavingsCertificate,
  );
  const activitySummary = portfoliosData
    ? buildHoldingActivitySummary(
        portfoliosData.transactions.filter(isHoldingTransactionForTicker),
      )
    : null;
  const [expandedMarketTicker, setExpandedMarketTicker] = React.useState<
    string | null
  >(null);
  const filteredTransactions = portfoliosData
    ? portfoliosData.transactions.filter(isHoldingTransactionForTicker)
    : [];
  const isMarketContextExpanded = expandedMarketTicker === ticker;

  const closeModalAndResetMarketContext = () => {
    setExpandedMarketTicker(null);
    closeModal();
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModalAndResetMarketContext();
      }}
      title={positionSummary?.symbol ?? t("holding-details")}
      contentClassName="max-w-[960px]"
    >
      <div className="flex w-full flex-col gap-6">
        {!positionSummary || !ticker ? (
          <UnavailableState message={t("holding-data-unavailable")} />
        ) : (
          <>
            <HoldingPositionHeader summary={positionSummary} />
            <HoldingPositionMetrics summary={positionSummary} />

            <section className="space-y-3">
              {isTransactionsLoading ? (
                <div className="flex h-[240px] items-center justify-center">
                  <Spinner />
                </div>
              ) : isTransactionsError ? (
                <UnavailableState message={t("holding-activity-unavailable")} />
              ) : portfoliosData ? (
                <>
                  <HoldingActivitySummary
                    summary={
                      activitySummary ?? {
                        transactionCount: 0,
                        firstTransactionDate: null,
                        lastTransactionDate: null,
                        totalBought: 0,
                        totalSold: 0,
                        dividendsReceived: 0,
                        netInvested: 0,
                      }
                    }
                    currency={positionSummary.currency}
                  />
                  <PortfolioTransactionsTable
                    transactions={filteredTransactions}
                    withTickerFilter={false}
                  />
                </>
              ) : null}
            </section>

            {hasMarketData ? (
              <details
                className="group border-border/70 bg-muted/10 rounded-xl border p-4"
                onToggle={(event) => {
                  setExpandedMarketTicker(
                    event.currentTarget.open ? ticker : null,
                  );
                }}
              >
                <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-start justify-between gap-4 rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <div className="space-y-1">
                    <Text className="text-foreground text-sm font-medium">
                      {t("market-context")}
                    </Text>
                  </div>
                  <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>

                <div className="mt-4 space-y-4">
                  {isMarketContextExpanded ? (
                    <>
                      <ErrorBoundary
                        fallback={<TickerDataFallback ticker={ticker} />}
                      >
                        <CompanyInfo ticker={ticker} compact />
                      </ErrorBoundary>
                      <ErrorBoundary
                        fallback={<TickerDataFallback ticker={ticker} />}
                      >
                        <FinancialMarketsTickerPrice ticker={ticker} compact />
                      </ErrorBoundary>
                      <ErrorBoundary
                        fallback={<TickerDataFallback ticker={ticker} />}
                      >
                        <HoldingValuationMetrics symbol={ticker} />
                      </ErrorBoundary>
                      <ErrorBoundary
                        fallback={<TickerDataFallback ticker={ticker} />}
                      >
                        <HoldingAnalystRatings symbol={ticker} />
                      </ErrorBoundary>
                    </>
                  ) : null}
                </div>
              </details>
            ) : null}

            {isSavingsCertificate && !isStaticModeCertificate && holding ? (
              <CertificadoAforroAccrualPanel holding={holding} />
            ) : null}
          </>
        )}
      </div>
    </DrawerDialog>
  );
};

export default PortfolioHoldingDetailsModal;
