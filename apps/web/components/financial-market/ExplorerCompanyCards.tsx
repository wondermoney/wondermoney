"use client";

import { ArrowUpRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import useTickerLastClose from "@/lib/api/financial-markets/useTickerLastClose";
import useTickerQuote from "@/lib/api/financial-markets/useTickerQuote";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { FinancialAssetLogo } from "../FinancialAssetLogo";
import { Skeleton } from "../ui/skeleton";
import { formatQuotePrice } from "./quote-price";

// Familiar starting points, not a ranking or a recommendation. Prices come
// from the configured market-data source, never from these display labels.
const companies = [
  ["AAPL.US", "Apple"],
  ["MSFT.US", "Microsoft"],
  ["NVDA.US", "NVIDIA"],
  ["AMZN.US", "Amazon"],
  ["GOOGL.US", "Alphabet"],
  ["META.US", "Meta"],
  ["BRK-B.US", "Berkshire Hathaway"],
  ["JPM.US", "JPMorgan Chase"],
  ["V.US", "Visa"],
] as const;

function CompanyCard({ symbol, name }: { symbol: string; name: string }) {
  const t = useTranslations();
  const formatter = useFormatter();
  const formatCurrency = useFormatCurrency();
  const formatPercentage = useFormatPercentage();
  const quote = useTickerQuote(symbol, {
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const lastClose = useTickerLastClose(symbol, {
    enabled: quote.isSuccess && quote.data.price === null,
  });
  const price = quote.data?.price ?? lastClose?.close;
  const change = quote.data?.changePercentage ?? lastClose?.changePercentage;
  const closeDate = quote.data?.price === null ? lastClose?.date : null;

  return (
    <Link
      href={{
        pathname: "/financial-markets/explorer",
        query: { ticker: symbol },
      }}
      className="border-border hover:bg-accent focus-visible:ring-ring flex min-w-0 flex-col gap-4 rounded-lg border p-4 focus-visible:ring-2 focus-visible:outline-hidden"
    >
      <div className="flex items-start gap-3">
        <FinancialAssetLogo symbol={symbol} />
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground truncate text-sm font-medium">
            {quote.data?.name ?? name}
          </h3>
          <p className="text-muted-foreground font-mono text-xs">{symbol}</p>
        </div>
        <ArrowUpRight
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
      </div>
      {quote.isPending ? (
        <Skeleton className="h-7 w-24" />
      ) : price == null ? (
        <p className="text-muted-foreground text-sm">
          {t("market-data-unavailable")}
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-foreground font-mono text-xl font-medium">
            {formatQuotePrice(
              formatCurrency,
              price,
              quote.data?.currency ?? null,
            )}
          </p>
          {change != null ? (
            <p className={cn("font-mono text-xs", getDeltaClassName(change))}>
              <span className="text-muted-foreground mr-1">
                {t("period-1d")}
              </span>
              {formatPercentage(change / 100, {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
                signDisplay: "exceptZero",
              })}
            </p>
          ) : null}
        </div>
      )}
      {closeDate ? (
        <p className="text-muted-foreground text-xs">
          {t("last-close-on", {
            date: formatter.dateTime(new Date(closeDate + "T12:00:00Z"), {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }),
          })}
        </p>
      ) : null}
    </Link>
  );
}

export function ExplorerCompanyCards() {
  const t = useTranslations();
  return (
    <section className="space-y-3" aria-labelledby="explorer-companies-title">
      <h2 id="explorer-companies-title" className="text-base font-medium">
        {t("financial-markets-example-companies")}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {companies.map(([symbol, name]) => (
          <CompanyCard key={symbol} symbol={symbol} name={name} />
        ))}
      </div>
    </section>
  );
}
