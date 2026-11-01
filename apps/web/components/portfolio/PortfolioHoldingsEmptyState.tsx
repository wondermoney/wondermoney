"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { Text } from "@/components/ui/Typography";

interface PortfolioHoldingsEmptyStateProps {
  onCreatePortfolio: () => void;
}

type AssetTypeKey = "Stock" | "ETF";

const sampleHoldings: {
  type: AssetTypeKey;
  typeBadgeClass: string;
  ticker: string;
  allocation: number;
  qty: number;
  currentValue: string;
  color: string;
}[] = [
  {
    type: "Stock",
    typeBadgeClass: "border-warning-text/30 text-warning-text",
    ticker: "AAPL",
    allocation: 35,
    qty: 10,
    currentValue: "€1,895.00",
    color: "var(--chart-1)",
  },
  {
    type: "Stock",
    typeBadgeClass: "border-warning-text/30 text-warning-text",
    ticker: "MSFT",
    allocation: 28,
    qty: 8,
    currentValue: "€3,298.40",
    color: "var(--chart-2)",
  },
  {
    type: "ETF",
    typeBadgeClass: "border-success-text/30 text-success-text",
    ticker: "VWCE",
    allocation: 22,
    qty: 15,
    currentValue: "€1,684.50",
    color: "var(--chart-3)",
  },
  {
    type: "Stock",
    typeBadgeClass: "border-warning-text/30 text-warning-text",
    ticker: "TSLA",
    allocation: 15,
    qty: 5,
    currentValue: "€1,229.00",
    color: "var(--chart-4)",
  },
];

const PortfolioHoldingsEmptyState: React.FC<
  PortfolioHoldingsEmptyStateProps
> = ({ onCreatePortfolio }) => {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-xl font-semibold tracking-tight">
          {t("holdings")}
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("portfolio-holdings-empty-description")}
        </p>
      </div>

      {/* Preview */}
      <div className="border-border bg-card rounded-lg border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-foreground text-sm font-medium">
            {t("holdings")}
          </span>
          <PreviewBadge />
        </div>
        <div className="overflow-hidden">
          {/* Table header */}
          <div className="border-border bg-muted/40 grid grid-cols-5 gap-1 border-b px-4 py-2.5">
            {[
              t("type"),
              t("ticker"),
              t("allocation"),
              t("quantity"),
              t("current-value"),
            ].map((h, i) => (
              <Text
                key={i}
                className={`text-muted-foreground text-[11px] font-medium ${i >= 3 ? "text-right" : ""}`}
              >
                {h}
              </Text>
            ))}
          </div>

          {/* Table rows */}
          {sampleHoldings.map((holding, index) => (
            <div
              key={index}
              className="border-border grid grid-cols-5 items-center gap-1 border-b px-4 py-3 last:border-0"
            >
              <div>
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${holding.typeBadgeClass}`}
                >
                  {t(holding.type)}
                </span>
              </div>
              <Text className="text-foreground font-mono text-xs font-medium">
                {holding.ticker}
              </Text>
              <div className="flex items-center gap-1.5">
                <div className="bg-muted h-1.5 w-12 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${holding.allocation}%`,
                      backgroundColor: holding.color,
                    }}
                  />
                </div>
                <Text className="text-muted-foreground font-mono text-[11px] font-medium">
                  {holding.allocation}%
                </Text>
              </div>
              <Text className="text-muted-foreground text-right font-mono text-xs">
                {holding.qty}
              </Text>
              <Text className="text-foreground text-right font-mono text-xs font-medium">
                {holding.currentValue}
              </Text>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div>
        <Button className="gap-2" onClick={onCreatePortfolio}>
          <Plus className="size-4" />
          {t("portfolio-holdings-empty-create-first")}
        </Button>
      </div>
    </div>
  );
};

export default PortfolioHoldingsEmptyState;
