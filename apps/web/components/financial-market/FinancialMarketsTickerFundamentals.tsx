"use client";

import { useLocale, useTranslations } from "next-intl";

import { MarketDataNotCovered } from "@/components/financial-market/MarketDataNotCovered";
import { Amount } from "@/components/ui/Amount";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import { isMarketDataNotCovered } from "@/lib/api/financial-markets/market-data-coverage";
import useTickerFundamentals from "@/lib/api/financial-markets/useTickerFundamentals";
import useTickerInfo from "@/lib/api/financial-markets/useTickerInfo";
import useTickerPriceStatistics from "@/lib/api/financial-markets/useTickerPriceStatistics";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatNumber } from "@/lib/utils/useFormatNumber";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";


interface FinancialMarketsTickerFundamentalsProps {
  ticker: string;
}

// The provider occasionally returns a non-empty but unparseable `nextEarningsDate`.
// A bare `Intl.DateTimeFormat().format(new Date(bad))` throws `RangeError: Invalid time
// value` mid-render — which, unguarded, takes down the whole fundamentals card. Guard the
// parse and fall back to "-" so a bad date degrades gracefully instead of throwing.
function formatEarningsDate(
  value: string | null | undefined,
  locale: string,
): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  // Locale is passed in rather than left `undefined`, which would resolve
  // to the runtime's rather than the reader's.
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex w-full items-baseline justify-between gap-4">
      <Text variant="smallText" className="text-muted-foreground">
        {label}
      </Text>
      <Text
        variant="smallText"
        className="text-foreground whitespace-nowrap font-mono font-semibold tabular-nums"
      >
        {value}
      </Text>
    </div>
  );
}

const FinancialMarketsTickerFundamentals: React.FC<
  FinancialMarketsTickerFundamentalsProps
> = ({ ticker }) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatNumber = useFormatNumber();
  const formatCurrency = useFormatCurrency();
  const locale = useLocale();
  const {
    data: fundamentalsData,
    isLoading: isLoadingFundamentalsData,
    isError: isFundamentalsError,
    error: fundamentalsError,
  } = useTickerFundamentals(ticker);
  const {
    data: infoData,
    isLoading: isLoadingInfoData,
    isError: isInfoError,
  } = useTickerInfo(ticker);
  // Fundamentals sit behind a market-data tier this plan does not have, so this
  // panel falls back to the statistics a year of end-of-day prices can answer
  // on its own rather than rendering an empty box.
  const isFundamentalsNotCovered = isMarketDataNotCovered(fundamentalsError);
  const { statistics, isLoading: isLoadingStatistics } = useTickerPriceStatistics(
    ticker,
    { enabled: isFundamentalsNotCovered },
  );

  if (
    isLoadingInfoData ||
    isLoadingFundamentalsData ||
    (isFundamentalsNotCovered && isLoadingStatistics)
  ) {
    return (
      <Card className="flex min-h-[260px] w-full items-center justify-center">
        <Spinner />
      </Card>
    );
  }

  if (isFundamentalsNotCovered) {
    const currency = infoData?.companyInformation?.currency;

    if (!statistics) {
      return <MarketDataNotCovered title={t("key-statistics")} />;
    }

    return (
      <Card className="w-full">
        <CardHeader className="pb-2">
          <Heading variant="h2" className="text-base">
            {t("key-statistics")}
          </Heading>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <MetricRow
            label={t("last-close")}
            value={<Amount value={statistics.lastClose} currency={currency} />}
          />
          <MetricRow
            label={t("52-week-range")}
            value={
              <>
                <Amount value={statistics.yearLow} currency={currency} />
                {" – "}
                <Amount value={statistics.yearHigh} currency={currency} />
              </>
            }
          />
          <MetricRow
            label={t("avg-volume")}
            value={
              statistics.averageVolume != null
                ? formatNumber(Math.round(statistics.averageVolume))
                : "-"
            }
          />
          <MetricRow
            label={t("change-1y")}
            value={
              statistics.yearChangePercentage != null ? (
                <span
                  className={getDeltaClassName(statistics.yearChangePercentage)}
                >
                  {formatPercentage(
                    statistics.yearChangePercentage / 100,
                    {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    signDisplay: "exceptZero",
                  },
                  )}
                </span>
              ) : (
                "-"
              )
            }
          />
          <Text
            variant="smallText"
            className="text-muted-foreground text-xs text-pretty"
          >
            {t("key-statistics-basis", { count: statistics.sessions })}
          </Text>
        </CardContent>
      </Card>
    );
  }

  if (isFundamentalsError || isInfoError || !fundamentalsData || !infoData) {
    return (
      <Card className="flex min-h-[260px] w-full items-center justify-center border-dashed p-6 text-center">
        <Text variant="smallText" className="text-muted-foreground">
          {t("market-data-unavailable")}
        </Text>
      </Card>
    );
  }

  const { quote, metrics } = fundamentalsData.fundamentals;
  const currency = infoData.companyInformation?.currency;

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <Heading variant="h2" className="text-base">
          {t("fundamentals")}
        </Heading>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MetricRow
          label={t("market-cap")}
          value={quote.marketCap != null ? formatNumber(quote.marketCap) : "-"}
        />
        {/* A ReactNode, not JSX interpolated into a template literal, which
            would render the markup as text: `$<Amount value={quote.yearLow} .../>`. */}
        <MetricRow
          label={t("52-week-range")}
          value={
            quote.yearLow != null && quote.yearHigh != null ? (
              <>
                <Amount value={quote.yearLow} currency={currency} />
                {" – "}
                <Amount value={quote.yearHigh} currency={currency} />
              </>
            ) : (
              "-"
            )
          }
        />
        <MetricRow
          label={t("avg-volume")}
          value={quote.volume != null ? formatNumber(quote.volume) : "-"}
        />
        <MetricRow
          label={t("pe-ttm")}
          value={metrics?.peTtm != null ? metrics.peTtm.toFixed(2) : "-"}
        />
        <MetricRow
          label={t("eps-ttm")}
          value={
            metrics?.epsTtm != null
              ? formatCurrency(metrics.epsTtm, currency)
              : "-"
          }
        />
        <MetricRow
          label={t("dividend-yield")}
          value={
            metrics?.dividendYieldTtm != null
              ? formatPercentage(metrics.dividendYieldTtm, {
                  maximumFractionDigits: 2,
                })
              : "-"
          }
        />
        <MetricRow
          label={t("beta-5y-monthly")}
          value={infoData.companyInformation?.beta ?? "-"}
        />
        <MetricRow
          label={t("next-earnings")}
          value={formatEarningsDate(metrics?.nextEarningsDate, locale)}
        />
      </CardContent>
    </Card>
  );
};

export default FinancialMarketsTickerFundamentals;
