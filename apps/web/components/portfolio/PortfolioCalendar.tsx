"use client";

import { Calendar, DollarSign } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { Spinner } from "@/components/ui/Spinner";
import usePortfolioCalendar from "@/lib/api/portfolio/usePortfolioCalendar";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";

import { FinancialAssetLogo } from "../FinancialAssetLogo";

interface PortfolioCalendarProps {
  holdings?: PortfolioHolding[];
}

const calendarEmptyStateClass =
  "text-muted-foreground text-center text-xs font-normal leading-5";

function formatCalendarDate(locale: string, value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date =
    year && month && day ? new Date(year, month - 1, day) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function formatEpsEstimate(locale: string, value: number) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRevenueEstimate(locale: string, value: number) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}

const PortfolioCalendar: React.FC<PortfolioCalendarProps> = ({ holdings }) => {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isLoading } = usePortfolioCalendar();

  const logoMap = useMemo(() => {
    if (!holdings) return new Map<string, string>();
    return new Map(
      holdings
        .filter((h) => h.financialAssetLogoUrl)
        .map((h) => [h.financialAssetSymbol, h.financialAssetLogoUrl!]),
    );
  }, [holdings]);

  const upcomingEarnings = useMemo(() => {
    if (!data?.earnings) return [];
    const now = new Date().toISOString().split("T")[0];
    return data.earnings
      .filter((e) => e.date >= now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [data?.earnings]);

  const upcomingDividends = useMemo(() => {
    if (!data?.dividends) return [];
    const now = new Date().toISOString().split("T")[0];
    return data.dividends
      .filter((e) => e.date >= now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [data?.dividends]);

  const hasData = upcomingEarnings.length > 0 || upcomingDividends.length > 0;

  return (
    <div className="p-4">
      {isLoading ? (
        <div className="flex h-50 items-center justify-center">
          <Spinner />
        </div>
      ) : !hasData ? (
        <div className="flex h-50 items-center justify-center">
          <p className={calendarEmptyStateClass}>{t("no-upcoming-events")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Upcoming Earnings */}
          <div>
            <div className="text-info-text mb-2 flex items-center gap-1 text-sm font-medium">
              <Calendar className="h-4 w-4" />
              {t("upcoming-earnings")}
            </div>
            <div className="space-y-1">
              {upcomingEarnings.length > 0 ? (
                upcomingEarnings.map((event, idx) => (
                  <div
                    key={`${event.symbol}-${event.date}-${idx}`}
                    className="flex items-start justify-between gap-3 py-1"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {logoMap.get(event.symbol) && (
                        <FinancialAssetLogo
                          symbol={event.symbol}
                          logoUrl={logoMap.get(event.symbol)!}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-foreground text-sm font-medium">
                          {event.symbol}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatCalendarDate(locale, event.date)}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs leading-5">
                      {event.epsEstimated != null ? (
                        <div>
                          <span className="text-muted-foreground">
                            {t("earnings-eps-estimate")}:
                          </span>{" "}
                          <span className="font-mono tabular-nums">
                            {formatEpsEstimate(locale, event.epsEstimated)}
                          </span>
                        </div>
                      ) : null}
                      {event.revenueEstimated != null ? (
                        <div>
                          <span className="text-muted-foreground">
                            {t("earnings-revenue-estimate")}:
                          </span>{" "}
                          <span className="font-mono tabular-nums">
                            {formatRevenueEstimate(
                              locale,
                              event.revenueEstimated,
                            )}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className={calendarEmptyStateClass}>
                  {t("no-upcoming-events")}
                </p>
              )}
            </div>
          </div>

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
