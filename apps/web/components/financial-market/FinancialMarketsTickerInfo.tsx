"use client";

import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import useCompanyInfo from "@/lib/api/financial-markets/useTickerInfo";
import useTickerLastClose from "@/lib/api/financial-markets/useTickerLastClose";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import appendSign from "../../lib/utils/appendSign";
import { Card } from "../ui/card";
import {
  LiveQuoteUnavailableNote,
  LiveQuoteUnavailableValue,
} from "./LiveQuoteUnavailable";

interface CompanyInformationProps {
  ticker: string | null;
  compact?: boolean;
  /**
   * Rendered at the right edge of the header. The explorer's watchlist toggle
   * used to sit outside this card, floating beside it and drifting with the
   * company name's length (RAD-610); it belongs to the instrument, so it is
   * laid out with it.
   */
  action?: React.ReactNode;
}

const calculateChangeInPercentage = (
  changeInCurrency: number,
  currenctPrice: number,
) => {
  return (changeInCurrency / (currenctPrice - changeInCurrency)) * 100;
};

const CompanyInformation: React.FC<CompanyInformationProps> = ({
  ticker,
  compact = false,
  action,
}) => {
  const t = useTranslations();
  const formatter = useFormatter();

  const { data, isLoading, isError } = useCompanyInfo(ticker!, {
    enabled: !!ticker,
  });
  const formatCurrency = useFormatCurrency();
  // Only asked for when the source really has no quote for this symbol, so a
  // provider that starts serving live prices costs nothing here.
  const lastClose = useTickerLastClose(ticker, {
    enabled: data?.companyInformation.price === null,
  });

  if (isLoading) {
    return <Spinner />;
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
        <Text variant="smallText" className="text-muted-foreground">
          {t("market-data-unavailable")}
        </Text>
      </div>
    );
  }

  const companyName = data.companyInformation.companyName;
  const symbol = data.companyInformation.symbol;
  // Price and changePercentage are null because the market-data source we run
  // on carries no live quote (RAD-449) — Intl.NumberFormat silently formats
  // null as "0.00", which would otherwise show a confidently wrong price
  // instead of an honest "unavailable" state. This is the steady state, not an
  // outage (RAD-548), so it gets a calm local treatment and nothing more.
  //
  // The one figure that *is* available is the last close from the price
  // history, which the chart on this same page already plots. Falling back to
  // it beats two bare dashes as long as the label says what it is and when it
  // is from (RAD-608) — a close is not a quote, and this must never be dressed
  // up as one.
  const changePercentage =
    data.companyInformation.changePercentage ?? lastClose?.changePercentage;
  const priceValue = data.companyInformation.price ?? lastClose?.close;
  const price =
    priceValue === undefined || priceValue === null
      ? null
      : formatCurrency(priceValue, data.companyInformation.currency);
  const change =
    changePercentage === null || changePercentage === undefined
      ? null
      : appendSign(changePercentage.toFixed(2), true, true);
  const isQuoteUnavailable = price === null || change === null;
  // Shown whenever the figures above came from the history rather than from a
  // quote, in place of the "no live price" note.
  const lastCloseNote =
    data.companyInformation.price === null && lastClose
      ? t("last-close-on", {
          date: formatter.dateTime(new Date(lastClose.date), {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })
      : null;

  if (compact) {
    return (
      <Card className="border-border/60 bg-muted/10 w-full">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-muted relative flex size-[32px] shrink-0 items-center justify-center rounded-sm">
              {data.companyInformation.image ? (
                <Image
                  src={data.companyInformation.image}
                  alt={companyName}
                  sizes="32px"
                  fill
                />
              ) : null}
            </div>
            <div className="min-w-0 space-y-0.5">
              <Text className="text-foreground truncate text-sm leading-tight font-medium">
                {companyName}
              </Text>
              <Text
                variant="smallText"
                className="text-muted-foreground font-mono text-xs"
              >
                {symbol}
              </Text>
              {data.companyInformation.industry ? (
                <Text
                  variant="smallText"
                  className="text-muted-foreground truncate text-xs"
                >
                  {data.companyInformation.industry}
                </Text>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 sm:min-w-[220px]">
            {action ? (
              <div className="flex items-center sm:justify-end">{action}</div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:justify-items-end">
              <div className="border-border/60 bg-background/40 rounded-md border px-3 py-2">
                <Text
                  variant="smallText"
                  className="text-muted-foreground text-[10px] tracking-wide uppercase"
                >
                  {t("price")}
                </Text>
                <Text className="text-foreground mt-0.5 font-mono text-sm font-semibold whitespace-nowrap">
                  {price ?? <LiveQuoteUnavailableValue />}
                </Text>
              </div>
              <div className="border-border/60 bg-background/40 rounded-md border px-3 py-2">
                <Text
                  variant="smallText"
                  className="text-muted-foreground text-[10px] tracking-wide uppercase"
                >
                  {t("change-day")}
                </Text>
                <Text
                  className={cn(
                    "mt-0.5 font-mono text-sm font-semibold",
                    getDeltaClassName(changePercentage ?? 0),
                  )}
                >
                  {change === null ? (
                    <LiveQuoteUnavailableValue />
                  ) : (
                    `${change} %`
                  )}
                </Text>
              </div>
            </div>
            {lastCloseNote ? (
              <Text
                variant="smallText"
                className="text-muted-foreground text-xs sm:text-right"
              >
                {lastCloseNote}
              </Text>
            ) : isQuoteUnavailable ? (
              <LiveQuoteUnavailableNote className="sm:text-right" />
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <div className="flex flex-wrap justify-between gap-4 p-4">
        <div className="bg-muted relative flex size-[40px] shrink-0 items-center justify-center self-center rounded-sm">
          {data.companyInformation.image ? (
            <Image
              src={data.companyInformation.image}
              alt={companyName}
              sizes="40px"
              fill
            />
          ) : null}
        </div>
        <div className="flex max-w-[430px] flex-col self-end">
          <Heading
            variant={compact ? "h4" : "h1"}
            className={cn(compact && "truncate")}
          >
            {companyName}
          </Heading>
          <Text variant="smallText" className="text-muted-foreground font-mono">
            {symbol}
          </Text>
        </div>
        <div className="flex flex-col self-end">
          <Text variant="smallText">{t("price")}</Text>
          <Text variant="largeText" className="font-bold whitespace-nowrap">
            {price ?? <LiveQuoteUnavailableValue />}
          </Text>
        </div>
        <div className="flex flex-col self-end">
          <Text variant="smallText">{t("change-day")}</Text>
          <Text
            variant="largeText"
            className={cn(
              "font-bold",
              getDeltaClassName(changePercentage ?? 0),
            )}
          >
            {change === null ? <LiveQuoteUnavailableValue /> : `${change} %`}
          </Text>
        </div>
        {data.companyInformation.industry && (
          <div className="flex flex-col self-end">
            <Text variant="smallText">{t("industry")}</Text>
            <Text className="flex flex-wrap items-center font-bold">
              {data.companyInformation.industry}
            </Text>
          </div>
        )}
        {action ? (
          <div className="ml-auto flex shrink-0 items-center self-center">
            {action}
          </div>
        ) : null}
        {lastCloseNote ? (
          <Text
            variant="smallText"
            className="text-muted-foreground basis-full text-xs"
          >
            {lastCloseNote}
          </Text>
        ) : isQuoteUnavailable ? (
          <LiveQuoteUnavailableNote className="basis-full" />
        ) : null}
      </div>
    </Card>
  );
};

export default CompanyInformation;
