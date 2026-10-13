"use client";

import {
  ArrowUpRight,
  BarChart3,
  PieChart,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { cn } from "@/lib/utils";

interface PortfolioEmptyStateProps {
  onCreatePortfolio: () => void;
}

// Sample tickers, not API holdings, so they use the system's own chart ramp
// rather than raw hex — the chart tokens hold their hue across both theme
// halves, matching BudgetsEmptyState's category chips. The ticker tile fills
// its swatch with white text, and the raw chart tokens don't have the
// contrast for that (chart-2 measures 3.19:1 in dark mode against white,
// same invisible-glyph failure class as the dark-mode ticker logos fixed
// elsewhere this audit) — darkening 20% toward black clears 4.5:1 on every
// slot in both themes while keeping each holding's hue identifiable.
const sampleHoldings = [
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    allocation: 35,
    change: "+2.4%",
    positive: true,
    color: "color-mix(in oklch, var(--chart-1) 80%, black)",
  },
  {
    ticker: "MSFT",
    name: "Microsoft Corp.",
    allocation: 28,
    change: "+1.8%",
    positive: true,
    color: "color-mix(in oklch, var(--chart-2) 80%, black)",
  },
  {
    ticker: "VWCE",
    name: "Vanguard FTSE",
    allocation: 22,
    change: "-0.3%",
    positive: false,
    color: "color-mix(in oklch, var(--chart-3) 80%, black)",
  },
  {
    ticker: "GOOGL",
    name: "Alphabet Inc.",
    allocation: 15,
    change: "+3.1%",
    positive: true,
    color: "color-mix(in oklch, var(--chart-4) 80%, black)",
  },
];

const PortfolioEmptyState: React.FC<PortfolioEmptyStateProps> = ({
  onCreatePortfolio,
}) => {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t("activation-portfolio-title")}
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("activation-portfolio-description")}
        </p>
      </div>

      {/* Primary CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Button size="lg" className="gap-2" onClick={onCreatePortfolio}>
          <Plus className="size-4" />
          {t("portfolio-empty-create-first")}
        </Button>
      </div>

      {/* Data-forward preview */}
      <div className="border-border bg-card rounded-xl border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <span className="text-foreground text-sm font-medium">
            {t("portfolio-empty-what-you-get")}
          </span>
          <PreviewBadge />
        </div>

        <div className="p-4 sm:p-6">
          {/* Total value preview */}
          <div className="mb-6">
            <p className="text-muted-foreground mb-1 text-sm">
              {t("total-value")}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-foreground min-w-0 font-mono text-2xl font-semibold tracking-tight sm:text-3xl">
                €24,680.50
              </span>
              <span className="text-success-text font-mono text-sm font-medium whitespace-nowrap tabular-nums">
                +12.4%
              </span>
            </div>
          </div>

          {/* Metrics preview.
              One column until `sm`, matching AccountsEmptyStateV2's metric row.
              At 360px three columns leave ~76px of content width per tile, and
              a text-lg mono "€2,720.30" needs ~90px — so the values overflowed
              their tiles and overprinted the neighbour. */}
          {/* No second border — the outer card already has one; dividers
              alone carry the internal grouping (No-Nesting rule). */}
          <div className="divide-border mb-6 grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-4">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="text-muted-foreground h-3.5 w-3.5" />
                <p className="text-muted-foreground text-xs">
                  {t("total-return")}
                </p>
              </div>
              <p className="text-foreground mt-1 font-mono text-lg font-semibold whitespace-nowrap tabular-nums">
                €2,720.30
              </p>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="text-muted-foreground h-3.5 w-3.5" />
                <p className="text-muted-foreground text-xs">
                  {t("gain-loss")}
                </p>
              </div>
              <p className="text-success-text mt-1 font-mono text-lg font-semibold whitespace-nowrap tabular-nums">
                +€1,840.00
              </p>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-1.5">
                <PieChart className="text-muted-foreground h-3.5 w-3.5" />
                <p className="text-muted-foreground text-xs">
                  {t("annual-yield")}
                </p>
              </div>
              <p className="text-foreground mt-1 font-mono text-lg font-semibold whitespace-nowrap tabular-nums">
                3.2%
              </p>
            </div>
          </div>

          {/* Holdings + Allocation preview */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                {t("holdings")}
              </p>
              <div className="divide-border divide-y">
                {sampleHoldings.map((holding) => (
                  <div
                    key={holding.ticker}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold text-white"
                        style={{ backgroundColor: holding.color }}
                      >
                        {holding.ticker.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-foreground text-sm font-medium">
                          {holding.ticker}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {holding.name}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-foreground font-mono text-sm font-medium">
                        {holding.allocation}%
                      </span>
                      <div
                        className={cn(
                          "flex items-center justify-end gap-0.5 text-xs",
                          holding.positive
                            ? "text-success-text"
                            : "text-destructive-text",
                        )}
                      >
                        <ArrowUpRight
                          className={cn(
                            "h-3 w-3",
                            !holding.positive && "rotate-90",
                          )}
                        />
                        <span className="font-mono">{holding.change}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                {t("portfolio-empty-preview-allocation")}
              </p>
              {/* Allocation bar */}
              <div className="mb-4 flex h-3 overflow-hidden rounded-full">
                {sampleHoldings.map((holding) => (
                  <div
                    key={holding.ticker}
                    style={{
                      width: `${holding.allocation}%`,
                      backgroundColor: holding.color,
                    }}
                  />
                ))}
              </div>
              {/* Legend */}
              <div className="divide-border divide-y">
                {sampleHoldings.map((holding) => (
                  <div
                    key={holding.ticker}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: holding.color }}
                      />
                      <span className="text-foreground text-sm">
                        {holding.ticker}
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono text-sm">
                      {holding.allocation}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioEmptyState;
