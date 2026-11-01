"use client";

import { useTranslations } from "next-intl";

import { MarketDataNotCovered } from "@/components/financial-market/MarketDataNotCovered";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import {
  BarChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import { isMarketDataNotCovered } from "@/lib/api/financial-markets/market-data-coverage";
import useTickerFinancials from "@/lib/api/financial-markets/useTickerFinancials";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface FinancialMarketsTickerFinancialsProps {
  ticker: string;
}

const FinancialMarketsTickerFinancials: React.FC<
  FinancialMarketsTickerFinancialsProps
> = ({ ticker }) => {
  const t = useTranslations();
  const { formatCompactCurrency } = useChartFormatters();
  const { data, isLoading, isError, error } = useTickerFinancials(ticker, {
    select: (data) => ({
      companyFinancials: data?.companyFinancials?.slice().reverse().slice(0, 5) ?? [],
    }),
  });
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
    return <MarketDataNotCovered title={t("financials")} />;
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

  const chartConfig: ChartConfig = {
    revenue: { label: t("revenue"), color: "var(--chart-1)" },
    netIncome: { label: t("net-income"), color: "var(--chart-2)" },
  };

  if (data.companyFinancials.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-2">
          <Heading variant="h2" className="text-base">
            {t("financials")}
          </Heading>
        </CardHeader>
        <CardContent className="flex min-h-[200px] items-center justify-center">
          <Text variant="smallText" className="text-muted-foreground">
            {t("financial-markets-no-financials-data")}
          </Text>
        </CardContent>
      </Card>
    );
  }

  const interval = data.companyFinancials.reduce(
    (acc, item) => ({
      minValue: Math.min(acc.minValue, item.netIncome, item.revenue),
      maxValue: Math.max(acc.maxValue, item.netIncome, item.revenue),
    }),
    { minValue: 0, maxValue: 0 },
  );

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <Heading variant="h2" className="text-base">
          {t("financials")}
        </Heading>
      </CardHeader>
      <CardContent className="flex h-[300px] w-full items-center justify-center">
        <BarChartBase
          data={data.companyFinancials}
          xKey="calendarYear"
          keys={["revenue", "netIncome"]}
          config={chartConfig}
          className="h-[300px]"
          yDomain={[interval.minValue, interval.maxValue]}
          yFormatter={(value) => formatCompactCurrency(value, "USD")}
          tooltipValueFormatter={(value) => formatCurrency(Number(value), "USD")}
        />
      </CardContent>
    </Card>
  );
};

export default FinancialMarketsTickerFinancials;
