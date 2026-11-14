"use client";

import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { Spinner } from "@/components/ui/Spinner";
import usePortfolioCalendar from "@/lib/api/portfolio/usePortfolioCalendar";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";

import { FinancialAssetLogo } from "../FinancialAssetLogo";

interface PortfolioCalendarProps {
  holdings?: PortfolioHolding[];
  /**
   * The overview's member filter (`lib/household/member-attribution.ts`):
   * the dividends of the holdings those members own. Absent for everyone.
   */
  memberKeys?: string[];
}

const calendarEmptyStateClass =
  "text-muted-foreground text-center text-xs font-normal leading-5";

const PortfolioCalendar: React.FC<PortfolioCalendarProps> = ({
  holdings,
  memberKeys,
}) => {
  const t = useTranslations();
  const { data, isLoading } = usePortfolioCalendar(undefined, memberKeys);
  const dividends = data?.dividends;

  const logoMap = useMemo(() => {
    if (!holdings) return new Map<string, string>();
    return new Map(
      holdings
        .filter((h) => h.financialAssetLogoUrl)
        .map((h) => [h.financialAssetSymbol, h.financialAssetLogoUrl!]),
    );
  }, [holdings]);

  const upcomingDividends = useMemo(() => {
    if (!dividends) return [];
    const now = new Date().toISOString().split("T")[0];
    return dividends
      .filter((e) => e.date >= now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [dividends]);

  const hasData = upcomingDividends.length > 0;

  return (
    <div className="py-1">
      {isLoading ? (
        <div className="flex h-50 items-center justify-center">
          <Spinner />
        </div>
      ) : !hasData ? (
        <div className="flex h-50 items-center justify-center">
          <p className={calendarEmptyStateClass}>{t("no-upcoming-events")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {/* Upcoming Dividends */}
          <div>
            <div className="text-success-text mb-2 flex items-center gap-1 text-sm font-medium">
              <DollarSign className="h-4 w-4" />
              {t("upcoming-dividends")}
            </div>
            <div className="space-y-1">
              {upcomingDividends.length > 0 ? (
                upcomingDividends.map((event, idx) => (
                  <div
                    key={`${event.symbol}-${event.date}-${idx}`}
                    className="flex items-center justify-between py-1"
                  >
                    <div className="flex items-center gap-2">
                      {logoMap.get(event.symbol) && (
                        <FinancialAssetLogo
                          symbol={event.symbol}
                          logoUrl={logoMap.get(event.symbol)!}
                        />
                      )}
                      <span className="text-foreground text-sm font-medium">
                        {event.symbol}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {event.date}
                    </span>
                  </div>
                ))
              ) : (
                <p className={calendarEmptyStateClass}>
                  {t("no-upcoming-events")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioCalendar;
