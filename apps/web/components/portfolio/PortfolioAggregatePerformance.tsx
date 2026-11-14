"use client";

import { useTranslations } from "next-intl";

import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import PortfolioPerformanceChart from "@/components/portfolio/PortfolioPerformanceChart";
import type { Period } from "@/lib/api/portfolio/usePortfolioDashboard";
import { useMemberFilter } from "@/lib/household/useMemberFilter";

interface PortfolioAggregatePerformanceProps {
  period: Period;
  currency?: string;
}

/**
 * The portfolios overview's Performance section: every household portfolio's value and return
 * over the period.
 *
 * It follows the member filter (`?member=`, `lib/household/member-attribution.ts`): the chart
 * keeps the portfolios that member owns, and a former member's under Shared. The control sits in
 * the section's head because the rest of the overview stays the household's. The control, and the
 * filter, are absent in a household of one.
 */
export default function PortfolioAggregatePerformance({
  period,
  currency,
}: PortfolioAggregatePerformanceProps) {
  const t = useTranslations();
  const { memberKeys } = useMemberFilter();

  return (
    <section
      aria-labelledby="portfolio-performance-heading"
      className="border-foreground min-w-0 border-t-2 pt-4"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2
          id="portfolio-performance-heading"
          className="text-foreground text-lg font-semibold tracking-tight"
        >
          {t("performance")}
        </h2>
        <MemberFilterControl className="w-40 sm:w-44" />
      </div>
      <PortfolioPerformanceChart
        portfolioId={null}
        period={period}
        currency={currency}
        {...(memberKeys ? { memberKeys } : {})}
      />
    </section>
  );
}
