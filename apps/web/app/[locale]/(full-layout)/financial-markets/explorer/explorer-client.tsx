"use client";

import { Star } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import FinancialMarketsExplorerEmptyState from "@/components/financial-market/FinancialMarketsExplorerEmptyState";
import FinancialMarketsExplorerSearch from "@/components/financial-market/FinancialMarketsExplorerSearch";
import FinancialMarketsTickerEarnings from "@/components/financial-market/FinancialMarketsTickerEarnings";
import FinancialMarketsTickerFinancials from "@/components/financial-market/FinancialMarketsTickerFinancials";
import FinancialMarketsTickerFundamentals from "@/components/financial-market/FinancialMarketsTickerFundamentals";
import CompanyInfo from "@/components/financial-market/FinancialMarketsTickerInfo";
import FinancialMarketsTickerPrice from "@/components/financial-market/FinancialMarketsTickerPrice";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import useWatchlist, {
  useToggleWatchlist,
} from "@/lib/api/financial-markets/useWatchlist";
import { cn } from "@/lib/utils";

interface ExplorerClientProps {
  initialTicker: string | null;
}

export default function ExplorerClient({ initialTicker }: ExplorerClientProps) {
  const t = useTranslations();
  const posthog = usePostHog();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: watchlistSymbols = [] } = useWatchlist();
  const toggleWatchlist = useToggleWatchlist();

  const [selectedTicker, setSelectedTicker] = useState<string | null>(
    initialTicker,
  );

  // Sync state with URL changes
  useEffect(() => {
    const tickerFromUrl = searchParams.get("ticker");
    if (tickerFromUrl && tickerFromUrl !== selectedTicker) {
      setSelectedTicker(tickerFromUrl);
    }
  }, [searchParams, selectedTicker]);

  const onTickerSelected = (ticker: string) => {
    setSelectedTicker(ticker);
    posthog.capture("financial_markets_ticker_selected", { ticker });
    const params = new URLSearchParams(searchParams.toString());
    params.set("ticker", ticker);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isWatched =
    !!selectedTicker && watchlistSymbols.includes(selectedTicker);

  return (
    <PageShell>
      {/* RAD-566 — with a ticker selected this route's outline was h2, h2, h2
          and no <h1>. The company card is about one symbol, not about the
          page, so the page title lives here rather than being promoted out of
          a card that changes with the search. */}
      <PageHeader
        title={t("navigation.explorer")}
      />
      {!!selectedTicker ? (
        <div className="flex flex-col gap-4">
          <FinancialMarketsExplorerSearch
            onTickerSelected={onTickerSelected}
            selectedTicker={selectedTicker}
          />
          <CompanyInfo
            ticker={selectedTicker}
            action={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-pressed={isWatched}
                aria-label={
                  isWatched
                    ? t("financial-markets-remove-from-watchlist")
                    : t("financial-markets-add-to-watchlist")
                }
                onClick={() =>
                  selectedTicker &&
                  toggleWatchlist.mutate({ isWatched, symbol: selectedTicker })
                }
              >
                <Star
                  className={cn("size-4", isWatched && "fill-current")}
                  aria-hidden="true"
                />
              </Button>
            }
          />
          <FinancialMarketsTickerPrice ticker={selectedTicker} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FinancialMarketsTickerFundamentals ticker={selectedTicker} />
            <FinancialMarketsTickerFinancials ticker={selectedTicker} />
            <FinancialMarketsTickerEarnings ticker={selectedTicker} />
          </div>
        </div>
      ) : (
        <FinancialMarketsExplorerEmptyState>
          <FinancialMarketsExplorerSearch
            onTickerSelected={onTickerSelected}
            selectedTicker={selectedTicker}
          />
        </FinancialMarketsExplorerEmptyState>
      )}
    </PageShell>
  );
}
