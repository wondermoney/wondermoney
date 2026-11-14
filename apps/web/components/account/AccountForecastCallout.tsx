"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import type { ForecastSeries } from "@/lib/api/account/useAccountForecast";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

interface AccountForecastCalloutProps {
  days: number;
  series: ForecastSeries;
}

/**
 * The lowest projected balance in the window, beside the balance chart.
 *
 * A projection, so it is stated as one: a dashed edge, the day it happens, and the figure in the
 * series' own currency. When the account has no balance to start from, it says so instead of
 * drawing a zero.
 */
export default function AccountForecastCallout({
  days,
  series,
}: AccountForecastCalloutProps) {
  const t = useTranslations();
  const formatShortDate = useFormatShortDate();

  if (!series.lowPoint || series.openingBalance == null) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("forecast.unavailable")}
      </p>
    );
  }

  return (
    <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium">
          {t("forecast.lowPoint", { days })}
        </p>
        <p className="text-foreground text-sm">
          {formatShortDate(
            transactionDisplayDate(`${series.lowPoint.date}T00:00:00.000Z`),
          )}
        </p>
      </div>
      <p className="text-foreground shrink-0 font-mono text-lg font-semibold tabular-nums">
        <Amount
          value={series.lowPoint.balance}
          currency={series.currency}
        />
      </p>
    </div>
  );
}
