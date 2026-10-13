"use client";

import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { Amount } from "@/components/ui/Amount";
import { Spinner } from "@/components/ui/Spinner";
import useDividendIncome from "@/lib/api/portfolio/useDividendIncome";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface PortfolioDividendIncomeProps {
  portfolioId: number | null;
  currency?: string;
}

const PortfolioDividendIncome: React.FC<PortfolioDividendIncomeProps> = ({
  portfolioId,
  currency = "USD",
}) => {
  const t = useTranslations();
  const { data, isLoading } = useDividendIncome(portfolioId);
  const formatCurrency = useFormatCurrency();

  return (
    <div className="p-4">
      {isLoading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Spinner />
        </div>
      ) : !data || data.totalDividends === 0 ? (
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          {t("no-dividends")}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Total */}
          <div className="flex items-center gap-3">
            <div className="bg-success/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <DollarSign className="text-success-text h-5 w-5" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">
                {t("total-dividends")}
              </span>
              <span className="text-foreground font-mono text-lg font-semibold">
                <Amount value={data.totalDividends} currency={currency} />
              </span>
            </div>
          </div>

          {/* By Asset */}
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm font-medium">
              {t("dividends-by-asset")}
            </span>
            {data.byAsset
              .sort((a, b) => b.totalDividends - a.totalDividends)
              .map((asset) => (
                <div
                  key={asset.financialAssetKey}
                  className="flex items-center justify-between"
                >
                  <span className="text-foreground text-sm font-medium">
                    {asset.symbol}
                  </span>
                  <span className="text-foreground font-mono text-sm">
                    <Amount value={asset.totalDividends} currency={currency} />
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioDividendIncome;
