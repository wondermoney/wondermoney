"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Text } from "@/components/ui/Typography";
import useRealizedGains from "@/lib/api/portfolio/useRealizedGains";
import { useFormatQuantity } from "@/lib/privacy/useFormatQuantity";

import { FinancialAssetLogo } from "../FinancialAssetLogo";

const dateFormatOptions = {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
} as const;

interface PortfolioClosedPositionsProps {
  /** One portfolio, or `null` for every portfolio of the household. */
  portfolioId: number | null;
  /**
   * The overview's member filter (`lib/household/member-attribution.ts`):
   * the portfolios those members own. Absent for everyone, and for one
   * portfolio.
   */
  memberKeys?: string[];
}

/**
 * Assets sold out of the portfolio (or, for all portfolios, out of every one
 * of them), with their lifetime realized result. They no longer appear among
 * the holdings, so this is where what they made or lost stays visible.
 * Renders nothing when there are none.
 */
export default function PortfolioClosedPositions({
  portfolioId,
  memberKeys,
}: PortfolioClosedPositionsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const formatQuantity = useFormatQuantity();
  const { data } = useRealizedGains(portfolioId, null, undefined, memberKeys);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, dateFormatOptions),
    [locale],
  );

  if (!data || data.closedPositions.length === 0) return null;

  return (
    <section className="border-foreground min-w-0 border-t-2 pt-4">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">
          {t("closed-positions")}
        </h2>
        <Text variant="smallText" className="text-muted-foreground">
          {t("closed-positions-description")}
        </Text>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                {t("realized-gains-asset")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("closed-positions-sold-quantity")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("realized-gains-proceeds")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("realized-gains-cost-basis")}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t("realized-gains-gain")}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t("closed-positions-last-sale")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.closedPositions.map((position) => (
              <tr
                key={position.financialAssetKey}
                className="border-border/70 border-t"
              >
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <FinancialAssetLogo
                      symbol={position.symbol}
                      logoUrl={position.financialAssetLogoUrl ?? undefined}
                    />
                    <div className="min-w-0">
                      <span className="text-foreground block font-mono">
                        {position.symbol}
                      </span>
                      <span className="text-muted-foreground block max-w-[14rem] truncate text-xs">
                        {position.financialAssetName}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                  {formatQuantity(position.quantity, {
                    maximumFractionDigits: 6,
                  })}
                </td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                  <Amount
                    value={position.proceeds}
                    currency={data.currencyCode}
                  />
                </td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                  <Amount
                    value={position.costBasis}
                    currency={data.currencyCode}
                  />
                </td>
                <td className="py-2.5 pr-4 text-right font-mono whitespace-nowrap tabular-nums">
                  <Amount
                    value={position.realizedGain}
                    currency={data.currencyCode}
                    tone="delta"
                    signed
                  />
                </td>
                <td className="py-2.5 text-right font-mono whitespace-nowrap tabular-nums">
                  {dateFormatter.format(new Date(position.lastSaleDate))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
