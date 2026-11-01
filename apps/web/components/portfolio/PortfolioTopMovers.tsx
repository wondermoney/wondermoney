"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { Amount } from "@/components/ui/Amount";
import { Spinner } from "@/components/ui/Spinner";
import type { Period } from "@/lib/api/portfolio/usePortfolioDashboard";
import usePortfolioTopMovers, {
  type TopMover,
} from "@/lib/api/portfolio/usePortfolioTopMovers";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { FinancialAssetLogo } from "../FinancialAssetLogo";

interface PortfolioTopMoversProps {
  portfolioId: number | null;
  period: Period;
  currency?: string;
}

interface MoverItemProps {
  mover: TopMover;
  isGainer: boolean;
  currency: string;
}

const MoverItem: React.FC<MoverItemProps> = ({ mover, isGainer, currency }) => {
  const formatCurrency = useFormatCurrency();
  const formatPercentage = useFormatPercentage();
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        {mover.logoUrl ? (
          <FinancialAssetLogo symbol={mover.ticker} logoUrl={mover.logoUrl} />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {mover.ticker.charAt(0)}
          </div>
        )}
        <span className="text-sm font-medium text-foreground">{mover.ticker}</span>
      </div>
      <div className="flex flex-col items-end">
        <div
          className={cn(
            "flex items-center gap-1 font-semibold",
            isGainer ? "text-success-text" : "text-destructive-text",
          )}
        >
          {isGainer ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          <span>
            {formatPercentage(mover.change / 100, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
              signDisplay: "exceptZero",
            })}
          </span>
        </div>
        {mover.contribution !== 0 && (
          <span className={cn("text-xs", isGainer ? "text-success-text" : "text-destructive-text")}>
            {mover.contribution > 0 ? "+" : ""}<Amount value={mover.contribution} currency={currency} />
          </span>
        )}
      </div>
    </div>
  );
};

const PortfolioTopMovers: React.FC<PortfolioTopMoversProps> = ({
  portfolioId,
  period,
  currency = "USD",
}) => {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  const { data: topMoversData, isLoading } = usePortfolioTopMovers(
    portfolioId,
    period,
    5,
  );

  const hasGainers = topMoversData?.gainers && topMoversData.gainers.length > 0;
  const hasLosers = topMoversData?.losers && topMoversData.losers.length > 0;
  const hasData = hasGainers || hasLosers;

  return (
    <div className="p-4">
      {isLoading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Spinner />
        </div>
      ) : !hasData ? (
        <div className="flex h-[200px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t("portfolio-top-movers-empty-state")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4">
          {/* Gainers Column */}
          <div>
            <div className="mb-2 flex items-center gap-1 text-sm font-medium text-success-text">
              <TrendingUp className="h-4 w-4" />
              {t("gainers")}
            </div>
            <div className="space-y-1">
              {topMoversData?.gainers?.map((mover) => (
                <MoverItem key={mover.ticker} mover={mover} isGainer currency={currency} />
              ))}
              {!hasGainers && (
                <span className="text-sm text-muted-foreground">{t("no-gainers")}</span>
              )}
            </div>
          </div>

          {/* Losers Column */}
          <div>
            <div className="mb-2 flex items-center gap-1 text-sm font-medium text-destructive-text">
              <TrendingDown className="h-4 w-4" />
              {t("losers")}
            </div>
            <div className="space-y-1">
              {topMoversData?.losers?.map((mover) => (
                <MoverItem
                  key={mover.ticker}
                  mover={mover}
                  isGainer={false}
                  currency={currency}
                />
              ))}
              {!hasLosers && (
                <span className="text-sm text-muted-foreground">{t("no-losers")}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioTopMovers;
