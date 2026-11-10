"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import type { ChartConfig } from "@/components/ui/chart";
import { AreaLineChartBase } from "@/components/ui/charts/area-line-chart-base";
import {
  calendarDay,
  chartPoints,
  type ValuePoint,
} from "@/lib/manual-assets/asset-view";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/**
 * The asset's value over time, in its own currency. Without a growth rule the
 * line steps on each valuation; with one it moves between them.
 */
export default function ManualAssetValueChart({
  history,
  currency,
  stepped,
}: {
  history: ValuePoint[];
  currency: string;
  stepped: boolean;
}) {
  const t = useTranslations("assets.detail.history");
  const formatCurrency = useFormatCurrency();
  const formatShortDate = useFormatShortDate();

  const data = useMemo(
    () =>
      chartPoints(history, { stepped }).map((point) => ({
        label: formatShortDate(calendarDay(point.date), {
          alwaysShowYear: true,
        }),
        value: point.value,
      })),
    [history, stepped, formatShortDate],
  );
  const config = useMemo<ChartConfig>(
    () => ({
      value: { label: t("seriesLabel"), color: "var(--color-chart-1)" },
    }),
    [t],
  );

  return (
    <AreaLineChartBase
      data={data}
      xKey="label"
      series={[{ key: "value", type: "area" }]}
      config={config}
      className="h-[280px]"
      yFormatter={(value) =>
        formatCurrency(value, currency, {
          notation: "compact",
          maximumFractionDigits: 1,
        })
      }
      tooltipValueFormatter={(value) => (
        <Amount
          value={Number(value)}
          currency={currency}
          className="font-mono whitespace-nowrap"
        />
      )}
    />
  );
}
