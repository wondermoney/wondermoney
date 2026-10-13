"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { Link } from "@/i18n/navigation";
import useTickerQuote from "@/lib/api/financial-markets/useTickerQuote";
import useWatchlist, {
  useToggleWatchlist,
} from "@/lib/api/financial-markets/useWatchlist";
import { cn } from "@/lib/utils";
import appendSign from "@/lib/utils/appendSign";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import {
  LiveQuoteUnavailableLabel,
  LiveQuoteUnavailableValue,
} from "./LiveQuoteUnavailable";

function WatchlistRow({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const toggleWatchlist = useToggleWatchlist();
  const { data, isLoading, isError } = useTickerQuote(symbol);
  const formatCurrency = useFormatCurrency();

  return (
    <div className="border-border flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <Link
        href={{
          pathname: "/financial-markets/explorer",
          query: { ticker: symbol },
        }}
        className="min-w-0 flex-1 space-y-0.5"
      >
        <div className="text-foreground truncate font-mono text-sm font-semibold">
          {symbol}
        </div>
        <Text variant="smallText" className="text-muted-foreground truncate">
          {data?.name ?? "—"}
        </Text>
      </Link>

      {isLoading ? (
        <Spinner size="small" />
      ) : isError || !data ? (
        <Text variant="smallText" className="text-muted-foreground">
          {t("market-data-unavailable")}
        </Text>
      ) : data.price === null && data.changePercentage === null ? (
        /* The market-data source we run on carries no live quote (RAD-449),
           and that is the steady state rather than an outage (RAD-548). Say so
           in the row itself, calmly, instead of printing a quote of zero — and
           without a spinner or a retry for something that will not recover. */
        <LiveQuoteUnavailableLabel />
      ) : (
        <div className="text-right">
          <div className="text-foreground font-mono text-sm font-semibold tabular-nums">
            {/* The quote endpoint doesn't return a currency code; USD is the
                same assumption the Financials/Earnings charts already make. */}
            {data.price === null ? (
              <LiveQuoteUnavailableValue />
            ) : (
              formatCurrency(data.price, "USD")
            )}
          </div>
          {data.changePercentage !== null ? (
            <div
              title={t("change-day")}
              className="flex items-center justify-end gap-1 font-mono text-xs tabular-nums"
            >
              {/* Visible period label so the % isn't ambiguous about its
                  timeframe (RAD-361). */}
              <span className="text-muted-foreground text-[10px] font-medium tracking-wide">
                {t("period-1d")}
              </span>
              <span
                aria-label={`${t("change-day")}: ${appendSign(
                  data.changePercentage.toFixed(2),
                  true,
                  true,
                )}%`}
                className={cn({
                  "text-success-text": data.changePercentage > 0,
                  "text-destructive-text": data.changePercentage < 0,
                  "text-muted-foreground": data.changePercentage === 0,
                })}
              >
                {appendSign(data.changePercentage.toFixed(2), true, true)}%
              </span>
            </div>
          ) : null}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("financial-markets-watchlist-remove-aria", {
          ticker: symbol,
        })}
        onClick={() => toggleWatchlist.mutate({ isWatched: true, symbol })}
      >
        <Star className="size-4 fill-current" aria-hidden="true" />
      </Button>
    </div>
  );
}

export default function FinancialMarketsWatchlist() {
  const t = useTranslations();
  const tNav = useTranslations("navigation");
  const { data: symbols = [], isLoading } = useWatchlist();

  return (
    <PageShell>
      <PageHeader
        title={tNav("watchlist")}
        description={t("financial-markets-watchlist-description")}
      />

      {isLoading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Spinner />
        </div>
      ) : symbols.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Text className="text-foreground font-medium">
              {t("financial-markets-watchlist-empty-title")}
            </Text>
            <Text
              variant="smallText"
              className="text-muted-foreground max-w-sm"
            >
              {t("financial-markets-watchlist-empty-description")}
            </Text>
            <Button asChild>
              <Link href="/financial-markets/explorer">
                {t("financial-markets-watchlist-go-to-explorer")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            {symbols.map((symbol) => (
              <WatchlistRow key={symbol} symbol={symbol} />
            ))}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
