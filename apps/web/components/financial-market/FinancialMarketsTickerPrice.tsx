"use client";

import { format, getDayOfYear, subDays } from "date-fns";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useMemo, useState } from "react";

import type { ChartConfig } from "@/components/ui/chart";
import {
  AreaLineChartBase,
  niceTicks,
  pickDateAxisTicks,
  useChartFormatters,
} from "@/components/ui/charts";
import ChartTimeframe, {
  type ChartTimeframeT,
} from "@/components/ui/ChartTimeframe";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import useTickerHistoryPrice from "@/lib/api/financial-markets/useTickerHistoryPrice";
import useCompanyInfo from "@/lib/api/financial-markets/useTickerInfo";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

const timeframes: ChartTimeframeT[] = [
  { label: "1w", valueInDays: 7 },
  { label: "1m", valueInDays: 30 },
  { label: "3m", valueInDays: 90 },
  { label: "1y", valueInDays: 365 },
  { label: "YTD", valueInDays: Math.max(5, getDayOfYear(new Date()) - 1) },
  { label: "All", valueInDays: null },
];
interface FinancialMarketsTickerPriceProps {
  ticker: string;
  compact?: boolean;
}

const FinancialMarketsTickerPrice: React.FC<
  FinancialMarketsTickerPriceProps
> = ({ ticker, compact = false }) => {
  const t = useTranslations();
  const { formatChartDate } = useChartFormatters();
  const formatCurrency = useFormatCurrency();
  const posthog = usePostHog();
  const [timeframe, setTimeframe] = useState(timeframes[4]);
  const onTimeframeChange = (timeframe: ChartTimeframeT) => {
    setTimeframe(timeframe);
    posthog.capture("financial_markets_ticker_price_timeframe_changed", {
      timeframe: timeframe.label,
    });
  };
  const timeframeFormatted = useMemo(
    () =>
      timeframe.valueInDays
        ? format(subDays(new Date(), timeframe.valueInDays), "yyyy-MM-dd")
        : undefined,
    [timeframe.valueInDays],
  );

  const { data, isError: isHistoryError } = useTickerHistoryPrice(
    ticker,
    timeframeFormatted,
    undefined,
    true,
    {
      select: useCallback((data: any) => {
        return data.companyHistoricalPrice.data.map((item: any) => ({
          x: item.date,
          close: item.close,
        }));
      }, []),
    },
  );
  const {
    data: companyInfo,
    isLoading: isCompanyInfoLoading,
    isError: isCompanyInfoError,
  } = useCompanyInfo(ticker, {
    enabled: Boolean(ticker),
  });
  const quoteCurrency = companyInfo?.companyInformation.currency;
  const isUnavailable =
    isHistoryError ||
    isCompanyInfoError ||
    (!isCompanyInfoLoading && !quoteCurrency);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      close: {
        label: ticker,
        color: "var(--chart-1)",
      },
    }),
    [ticker],
  );

  // Recharts anchors an area chart at zero unless told otherwise, and a share
  // price is nowhere near zero: AAPL over the year to date sits between about
  // 250 and 350, so nine tenths of the plot was empty and the whole year's
  // movement was squeezed into the top strip. A price series answers
  // "change over time", not "how big", and the fill here is already a gradient
  // that fades to 5% rather than a solid block reading as magnitude — so a
  // padded data window is the honest frame, not a truncated one.
  //
  // The window is expressed as rounded ticks rather than as the padded extremes
  // themselves, which is what made the axis read 239.15 / 269.15 / 299.15 /
  // 347.56 — even steps and then a jump (RAD-611).
  const yTicks = useMemo<number[] | undefined>(() => {
    const values = (data ?? [])
      .map((point: { close: number }) => point.close)
      .filter((value: number) => Number.isFinite(value));
    if (!values.length) return undefined;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = max === min ? Math.abs(max) * 0.05 || 1 : (max - min) * 0.08;

    return niceTicks(Math.max(0, min - pad), max + pad, 5);
  }, [data]);

  // Month starts over a long range, week starts over a medium one — and the
  // axis thins itself further if the chart is too narrow for all of them.
  const xTicks = useMemo<string[] | undefined>(() => {
    const dates = (data ?? []).map((point: { x: string }) => point.x);
    return dates.length ? pickDateAxisTicks(dates, 8) : undefined;
  }, [data]);

  if (isUnavailable) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-lg border border-dashed p-6 text-center">
        <Text variant="smallText" className="text-muted-foreground">
          {t("market-data-unavailable")}
        </Text>
      </div>
    );
  }

  if (!data || isCompanyInfoLoading) {
    return <Spinner />;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <ChartTimeframe
        timeframes={timeframes}
        activeTimeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        compact={compact}
      />
      {/* One height, not a contradictory `h-[400px] min-h-[500px]` pair where
          the min silently won and the chart ate 500px of a data-dense page
          (RAD-621). */}
      <div
        className={
          compact
            ? "flex h-[260px] w-full items-center justify-center"
            : "flex h-[320px] w-full items-center justify-center md:h-[420px]"
        }
      >
        <AreaLineChartBase
          data={data}
          xKey="x"
          series={[{ key: "close", type: "area" }]}
          config={chartConfig}
          className="h-full"
          xFormatter={(value) =>
            formatChartDate(value as string | number | Date)
          }
          yFormatter={(value) =>
            formatCurrency(value, quoteCurrency, { maximumFractionDigits: 2 })
          }
          yTicks={yTicks}
          xTicks={xTicks}
          tooltipValueFormatter={(value) =>
            formatCurrency(Number(value), quoteCurrency, {
              maximumFractionDigits: 2,
            })
          }
          showLegend={false}
        />
      </div>
    </div>
  );
};

export default FinancialMarketsTickerPrice;
