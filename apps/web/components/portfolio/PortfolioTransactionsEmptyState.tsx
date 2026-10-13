"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { cn } from "@/lib/utils";

interface PortfolioTransactionsEmptyStateProps {
  onAddTransaction: () => void;
  noPortfolios?: boolean;
}

const sampleTransactions = [
  {
    date: "Feb 14, 2026",
    type: "Buy",
    ticker: "AAPL",
    qty: 10,
    unitPrice: "€185.20",
    total: "€1,852.00",
  },
  {
    date: "Feb 10, 2026",
    type: "Buy",
    ticker: "VWCE",
    qty: 15,
    unitPrice: "€109.40",
    total: "€1,641.00",
  },
  {
    date: "Feb 05, 2026",
    type: "Buy",
    ticker: "MSFT",
    qty: 5,
    unitPrice: "€392.10",
    total: "€1,960.50",
  },
  {
    date: "Jan 28, 2026",
    type: "Sell",
    ticker: "TSLA",
    qty: 3,
    unitPrice: "€270.00",
    total: "€810.00",
  },
];

const typeBadge: Record<string, string> = {
  Buy: "bg-muted text-muted-foreground border-border",
  Sell: "bg-muted text-muted-foreground border-border",
  Dividend: "bg-muted text-muted-foreground border-border",
};

const PortfolioTransactionsEmptyState: React.FC<
  PortfolioTransactionsEmptyStateProps
> = ({ onAddTransaction, noPortfolios = false }) => {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("transactions")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {noPortfolios
              ? t("portfolio-transactions-no-portfolio-description")
              : t("portfolio-transactions-empty-description")}
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="overflow-hidden rounded-xl border border-dashed border-border bg-muted/20">
        <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("portfolio-transactions-empty-preview-label")}
            </p>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("portfolio-transactions-empty-preview-title")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("portfolio-transactions-empty-preview-description")}
              </p>
            </div>
          </div>
          <PreviewBadge className="w-fit" />
        </div>
        <div className="overflow-x-auto bg-background/70">
          <table className="w-full text-sm opacity-80">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("date")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("type")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("ticker")}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  {t("quantity")}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  {t("unit-price")}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  {t("total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sampleTransactions.map((tx, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{tx.date}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium",
                        typeBadge[tx.type] ?? "",
                      )}
                    >
                      {tx.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-medium text-foreground">
                    {tx.ticker}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {tx.qty}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {tx.unitPrice}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-medium text-foreground">
                    {tx.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CTA */}
      <div>
        <Button className="gap-2" onClick={onAddTransaction}>
          <Plus className="size-4" />
          {noPortfolios
            ? t("portfolio-empty-create-first")
            : t("portfolio-transactions-empty-add-first")}
        </Button>
      </div>
    </div>
  );
};

export default PortfolioTransactionsEmptyState;
