"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Amount } from "@/components/ui/Amount";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import useCompanyInfo from "@/lib/api/financial-markets/useTickerInfo";
import useHoldingAnalyst from "@/lib/api/portfolio/useHoldingAnalyst";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface HoldingAnalystRatingsProps {
  symbol: string;
}

const HoldingAnalystRatings: React.FC<HoldingAnalystRatingsProps> = ({
  symbol,
}) => {
  const t = useTranslations();
  const { data, isLoading } = useHoldingAnalyst(symbol);
  const { data: companyInfo, isLoading: isCompanyInfoLoading, isError: isCompanyInfoError } = useCompanyInfo(
    symbol,
    {
      enabled: Boolean(symbol),
    },
  );
  const formatCurrency = useFormatCurrency();
  const quoteCurrency = companyInfo?.companyInformation.currency;
  const isQuoteCurrencyUnavailable = isCompanyInfoError || (!isCompanyInfoLoading && !quoteCurrency);

  if (isLoading) {
    return (
      <div className="flex h-[100px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const hasPriceTarget = data?.priceTarget != null;
  const hasRecommendations =
    data?.recommendations && data.recommendations.length > 0;

  if (!hasPriceTarget && !hasRecommendations) {
    return null;
  }

  const rec = hasRecommendations ? data.recommendations[0] : null;

  const ratingItems = rec
    ? [
        {
          label: t("strong-buy"),
          value: rec.analystRatingsStrongBuy,
        },
        {
          label: t("buy"),
          value: rec.analystRatingsbuy,
        },
        {
          label: t("hold"),
          value: rec.analystRatingsHold,
        },
        {
          label: t("sell"),
          value: rec.analystRatingsSell,
        },
        {
          label: t("strong-sell"),
          value: rec.analystRatingsStrongSell,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <Text as="h4" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("market-research")}
      </Text>

      {hasPriceTarget && data.priceTarget ? (
        isQuoteCurrencyUnavailable ? (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <Text variant="smallText" className="text-muted-foreground">
              {t("market-data-unavailable")}
            </Text>
          </div>
        ) : isCompanyInfoLoading ? (
          <div className="flex h-[100px] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-muted/15 p-3">
              <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("target-low")}
              </Text>
              <Text className="font-mono text-base font-semibold text-foreground">
                <Amount value={data.priceTarget.targetLow} currency={quoteCurrency!} />
              </Text>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/15 p-3">
              <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("consensus-target")}
              </Text>
              <Text className="font-mono text-base font-semibold text-foreground">
                <Amount value={data.priceTarget.targetConsensus} currency={quoteCurrency!} />
              </Text>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/15 p-3">
              <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("target-high")}
              </Text>
              <Text className="font-mono text-base font-semibold text-foreground">
                <Amount value={data.priceTarget.targetHigh} currency={quoteCurrency!} />
              </Text>
            </div>
          </div>
        )
      ) : null}

      {rec && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ratingItems.map((item) => (
            <div
              key={item.label}
              className={cn(
                "rounded-lg border border-border/60 bg-muted/15 p-2 text-center",
                item.value === 0 && "opacity-70",
              )}
            >
              <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.label}
              </Text>
              <Text className="mt-1 font-mono text-base font-semibold text-foreground">
                {item.value}
              </Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HoldingAnalystRatings;
