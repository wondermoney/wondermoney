"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ExportCsvButton } from "@/components/reports/export/ExportCsvButton";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import useRealizedGains from "@/lib/api/portfolio/useRealizedGains";
import {
  realizedGainsCsvColumns,
  type RealizedGainsCsvLabels,
  realizedGainsCsvRows,
} from "@/lib/portfolio/realized-gains-csv";
import { useFormatQuantity } from "@/lib/privacy/useFormatQuantity";

import {
  FeeConversionMarker,
  FeeConversionNotice,
} from "./FeeConversionNotice";

const dateFormatOptions = {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
} as const;

interface PortfolioRealizedGainsProps {
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
 * What each sale made or lost, filtered by (UTC) tax year, with a CSV of the
 * same list. Proceeds are net of the sale's fee and the cost basis is what the
 * portfolio's method relieved, so the sales add up to the dashboard's realized
 * gains. Renders nothing until the portfolio has a sale.
 */
export default function PortfolioRealizedGains({
  portfolioId,
  memberKeys,
}: PortfolioRealizedGainsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const formatQuantity = useFormatQuantity();
  const [year, setYear] = useState<number | null>(null);
  const lifetime = useRealizedGains(portfolioId, null, undefined, memberKeys);
  const query = useRealizedGains(portfolioId, year, undefined, memberKeys);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, dateFormatOptions),
    [locale],
  );

  const years = useMemo(
    () => (lifetime.data?.byYear ?? []).map((entry) => entry.year).toReversed(),
    [lifetime.data],
  );

  // Nothing sold yet (or the read failed): the section stays out of the way.
  if (
    !lifetime.data ||
    lifetime.data.byYear.length + lifetime.data.disposals.length === 0
  ) {
    return null;
  }

  const data = query.data;
  const currency = data?.currencyCode ?? lifetime.data.currencyCode;
  const disposals = data?.disposals ?? [];
  const showPortfolio = portfolioId == null;
  const hasFeeWarning = disposals.some(
    (disposal) => disposal.feeConversionIncomplete,
  );

  const csvLabels: RealizedGainsCsvLabels = {
    asset: t("realized-gains-asset"),
    costBasis: t("realized-gains-cost-basis"),
    currency: t("realized-gains-currency"),
    date: t("realized-gains-date"),
    heldSince: t("realized-gains-held-since"),
    name: t("realized-gains-name"),
    portfolio: t("realized-gains-portfolio"),
    proceeds: t("realized-gains-proceeds"),
    quantity: t("realized-gains-quantity"),
    realizedGain: t("realized-gains-gain"),
  };
  const filename = `realized-gains-${year ?? "all-years"}`;

  return (
    <section className="border-foreground min-w-0 border-t-2 pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            {t("realized-gains")}
          </h2>
          <Text variant="smallText" className="text-muted-foreground">
            {t("realized-gains-description")}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t("realized-gains-year-filter")}
            className="flex flex-wrap gap-1"
          >
            {[null, ...years].map((option) => (
              <Button
                key={option ?? "all"}
                size="xs"
                variant={option === year ? "default" : "outline"}
                aria-pressed={option === year}
                onClick={() => setYear(option)}
                className="font-mono tabular-nums"
              >
                {option ?? t("realized-gains-all-years")}
              </Button>
            ))}
          </div>
          <ExportCsvButton
            filename={filename}
            columns={realizedGainsCsvColumns(csvLabels)}
            requestFn={async () => realizedGainsCsvRows(disposals, csvLabels)}
          />
        </div>
      </div>

      {query.isLoading || !data ? (
        <div className="flex h-[160px] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="bg-muted/30 rounded-lg p-3">
              <dt className="text-muted-foreground text-xs font-medium">
                {t("realized-gains-gain")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount
                  value={data.totals.realizedGain}
                  currency={currency}
                  tone="delta"
                  signed
                />
              </dd>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <dt className="text-muted-foreground text-xs font-medium">
                {t("realized-gains-proceeds")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount value={data.totals.proceeds} currency={currency} />
              </dd>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <dt className="text-muted-foreground text-xs font-medium">
                {t("realized-gains-cost-basis")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount value={data.totals.costBasis} currency={currency} />
              </dd>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <dt className="text-muted-foreground text-xs font-medium">
                {t("realized-gains-sales-label")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {data.totals.sales}
              </dd>
            </div>
          </dl>

          {disposals.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
              <Text variant="smallText" className="text-muted-foreground">
                {t("realized-gains-empty-year")}
              </Text>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      {t("realized-gains-date")}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      {t("realized-gains-asset")}
                    </th>
                    {showPortfolio ? (
                      <th
                        scope="col"
                        className="py-2 pr-4 text-left font-medium"
                      >
                        {t("realized-gains-portfolio")}
                      </th>
                    ) : null}
                    <th
                      scope="col"
                      className="py-2 pr-4 text-right font-medium"
                    >
                      {t("realized-gains-quantity")}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 text-right font-medium"
                    >
                      {t("realized-gains-proceeds")}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 text-right font-medium"
                    >
                      {t("realized-gains-cost-basis")}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 text-right font-medium"
                    >
                      {t("realized-gains-gain")}
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {t("realized-gains-held-since")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {disposals.map((disposal) => {
                    const rowCurrency = disposal.currencyCode ?? currency;
                    return (
                      <tr
                        key={disposal.transactionKey}
                        data-transaction-key={disposal.transactionKey}
                        className="border-border/70 border-t"
                      >
                        <td className="py-2.5 pr-4 font-mono whitespace-nowrap tabular-nums">
                          {dateFormatter.format(new Date(disposal.date))}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground font-mono">
                              {disposal.symbol}
                            </span>
                            {disposal.feeConversionIncomplete ? (
                              <FeeConversionMarker />
                            ) : null}
                          </div>
                          <span className="text-muted-foreground block max-w-[14rem] truncate text-xs">
                            {disposal.financialAssetName}
                          </span>
                        </td>
                        {showPortfolio ? (
                          <td className="text-muted-foreground py-2.5 pr-4">
                            {disposal.portfolioName}
                          </td>
                        ) : null}
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {formatQuantity(disposal.quantity, {
                            maximumFractionDigits: 6,
                          })}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          <Amount
                            value={disposal.proceeds}
                            currency={rowCurrency}
                          />
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          <Amount
                            value={disposal.costBasis}
                            currency={rowCurrency}
                          />
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono whitespace-nowrap tabular-nums">
                          <Amount
                            value={disposal.realizedGain}
                            currency={rowCurrency}
                            tone="delta"
                            signed
                          />
                        </td>
                        <td className="py-2.5 text-right font-mono whitespace-nowrap tabular-nums">
                          {disposal.holdingPeriodStart
                            ? dateFormatter.format(
                                new Date(disposal.holdingPeriodStart),
                              )
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {hasFeeWarning ? <FeeConversionNotice scope="gains" /> : null}
          <UnconvertedAmountsNotice completeness={data.completeness} />
        </div>
      )}
    </section>
  );
}
