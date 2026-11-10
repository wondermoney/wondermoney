"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Amount } from "@/components/ui/Amount";
import { Spinner } from "@/components/ui/Spinner";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
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
  // The totals are in the viewer's currency, which the API names.
  const totalsCurrency = data?.completeness?.currencyCode ?? currency;

  return (
    <div className="py-1">
      {isLoading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Spinner />
        </div>
      ) : !data || data.totalDividends === 0 ? (
        <div className="text-muted-foreground flex h-[200px] flex-col items-center justify-center gap-2">
          {t("no-dividends")}
          <UnconvertedAmountsNotice completeness={data?.completeness} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Total */}
          <div className="flex items-center">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">
                {t("total-dividends")}
              </span>
              <span className="text-foreground font-mono text-lg font-semibold">
                <Amount value={data.totalDividends} currency={totalsCurrency} />
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
                    <Amount
                      value={asset.totalDividends}
                      currency={totalsCurrency}
                    />
                  </span>
                </div>
              ))}
          </div>
          <UnconvertedAmountsNotice completeness={data.completeness} />
        </div>
      )}
    </div>
  );
};

export default PortfolioDividendIncome;
