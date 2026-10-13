"use client";

import { useTranslations } from "next-intl";

import DashboardNetWorthHistoryChart from "@/components/dashboard/DashboardNetWorthHistoryChart";
import DashboardNetworthTable from "@/components/dashboard/DashboardNetworthTable";
import { Amount } from "@/components/ui/Amount";
import DataLoadError from "@/components/ui/DataLoadError";
import { Spinner } from "@/components/ui/Spinner";
import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface DashboardNetWorthBlockProps {
  netWorth?: NetWorth;
  isLoading?: boolean;
  isError?: boolean;
  /** The query error, so a 429 degrades to the calm state, not to a fault. */
  error?: unknown;
  onRetry?: () => void;
}

export default function DashboardNetWorthBlock({
  netWorth,
  isLoading,
  isError,
  error,
  onRetry,
}: DashboardNetWorthBlockProps) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  if (isLoading && !netWorth) {
    return (
      <div className="border-border bg-card overflow-hidden rounded-lg border px-6 py-10">
        <div className="flex min-h-[220px] items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  if (isError && !netWorth) {
    // Net worth is the headline number in the product. A bare "Unavailable"
    // gives no cause, no recovery and no reassurance — say what happened and
    // offer a way out.
    return (
      <DataLoadError
        title={t("error-loading-data")}
        error={error}
        onRetry={onRetry}
        className="px-6 py-10"
      />
    );
  }

  const currencyCode = netWorth?.currencyCode ?? "EUR";
  const totalNetWorth = netWorth?.netWorth ?? 0;

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-4 px-5 py-5 md:px-6 md:py-6">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
              {t("net-worth")}
            </p>
            <p className="text-foreground font-mono text-3xl font-semibold tracking-tight md:text-4xl">
              <Amount value={totalNetWorth} currency={currencyCode} />
            </p>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
              {t("current")}
            </p>
          </div>

          <DashboardNetworthTable
            netWorth={netWorth}
            isLoading={isLoading}
            isError={isError}
          />
        </div>

        <div className="border-border border-t px-5 py-5 md:border-t-0 md:border-l md:px-6 md:py-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            {/* RAD-566 — this block is its own top-level dashboard section
                with no SectionHeader above it, so it opens at h2. As an h3 it
                sat directly under the page h1 and skipped a level. */}
            <h2 className="text-sm font-medium">{t("net-worth-history")}</h2>
            <span className="text-muted-foreground border-border rounded-full border px-2 py-1 text-xs font-medium">
              {t("net-worth-history-period-6m")}
            </span>
          </div>

          <DashboardNetWorthHistoryChart currencyCode={currencyCode} />
        </div>
      </div>
    </section>
  );
}
