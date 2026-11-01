"use client";

import { getQuarter, subQuarters } from "date-fns";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { useMemo } from "react";

import { MarketDataNotCovered } from "@/components/financial-market/MarketDataNotCovered";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { type ChartConfig, ChartTooltip } from "@/components/ui/chart";
import { ScatterChartBase } from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import { isMarketDataNotCovered } from "@/lib/api/financial-markets/market-data-coverage";
import useTickerEarnings from "@/lib/api/financial-markets/useTickerEarnings";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface FinancialMarketsTickerEarningsProps {
  ticker: string;
}

type EarningsTooltipContent = ComponentProps<typeof ChartTooltip>["content"];

const FinancialMarketsTickerEarnings: React.FC<
  FinancialMarketsTickerEarningsProps
> = ({ ticker }) => {
  const t = useTranslations();
  const { data, isLoading, isError, error } = useTickerEarnings(ticker, {
    select: (data) => ({
      companyEarnings: (data?.companyEarnings ?? [])
        .slice()
        .reverse()
        .slice(0, 6)
        .map((d) => {
          const dateInPrevQuarter = subQuarters(new Date(d.date), 1);
          const quarterStr = `Q${getQuarter(dateInPrevQuarter)}`;
          const yearStr = dateInPrevQuarter.getFullYear().toString().slice(2);
          return { ...d, date: `${quarterStr} ${yearStr}` };
        }),
    }),
  });

  const chartData = useMemo(
    () =>
      data?.companyEarnings.map((item) => ({
        date: item.date,
        actual: item.epsActual ?? undefined,
        expected: item.epsEstimated ?? undefined,
      })) ?? [],
    [data],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      actual: { label: t("actual"), color: "var(--chart-1)" },
      expected: { label: t("expected"), color: "var(--chart-2)" },
    }),
    [t],
  );
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card className="flex min-h-[260px] w-full items-center justify-center">
        <Spinner />
      </Card>
    );
  }

  // Not an outage: this capability is outside the current market-data plan and
  // the API says so with a 404.
  if (isMarketDataNotCovered(error)) {
    return <MarketDataNotCovered title={t("earnings")} />;
  }

  if (isError || !data) {
    return (
      <Card className="flex min-h-[260px] w-full items-center justify-center border-dashed p-6 text-center">
        <Text variant="smallText" className="text-muted-foreground">
          {t("market-data-unavailable")}
        </Text>
      </Card>
    );
  }

  if (data.companyEarnings.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-2">
          <Heading variant="h2" className="text-base">
            {t("earnings")}
          </Heading>
        </CardHeader>
        <CardContent className="flex min-h-[200px] items-center justify-center">
          <Text variant="smallText" className="text-muted-foreground">
            {t("financial-markets-no-earnings-data")}
          </Text>
        </CardContent>
      </Card>
    );
  }

  const knownValues = data.companyEarnings.flatMap((item) =>
    [item.epsActual, item.epsEstimated].filter((v): v is number => v != null),
  );
  const minValue = knownValues.length ? Math.min(0, ...knownValues) : 0;
  const maxValue = knownValues.length ? Math.max(0, ...knownValues) : 0;

  const renderTooltip: EarningsTooltipContent = ({ active, label, payload }) => {
    if (!active || !payload?.length) return null;

    const row = payload[0].payload as {
      actual?: number;
      expected?: number;
    };

    return (
      <div className="border-border/50 bg-background min-w-[10rem] rounded-lg border px-3 py-2 text-xs shadow-lg">
        <div className="mb-2 font-medium">{String(label)}</div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t("actual")}</span>
            <span className="font-mono font-medium tabular-nums">
              {formatCurrency(Number(row.actual ?? 0), "USD")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t("expected")}</span>
            <span className="font-mono font-medium tabular-nums">
              {formatCurrency(Number(row.expected ?? 0), "USD")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <Heading variant="h2" className="text-base">
          {t("earnings")}
        </Heading>
      </CardHeader>
      <CardContent className="flex h-[300px] w-full items-center justify-center">
        <ScatterChartBase
          data={chartData}
          xKey="date"
          series={[{ key: "actual" }, { key: "expected" }]}
          config={chartConfig}
          className="h-[300px]"
          yDomain={[minValue, maxValue]}
          yFormatter={(value) => formatCurrency(value, "USD")}
          tooltipContent={renderTooltip}
        />
      </CardContent>
    </Card>
  );
};

export default FinancialMarketsTickerEarnings;
