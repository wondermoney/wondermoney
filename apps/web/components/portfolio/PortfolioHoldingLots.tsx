"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import usePortfolioHoldingLots from "@/lib/api/portfolio/usePortfolioHoldingLots";

const dateFormatOptions = {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
} as const;

interface PortfolioHoldingLotsProps {
  currency: string;
  financialAssetKey: number;
  portfolioId: string;
}

/**
 * The purchase lots behind a holding. Under FIFO each buy is its own row and a sale closes the
 * oldest ones; under average cost every open unit is one pooled position. The figures are the
 * same ones the holding row and realized gains read, so the three always agree.
 */
export function PortfolioHoldingLots({
  currency,
  financialAssetKey,
  portfolioId,
}: PortfolioHoldingLotsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const query = usePortfolioHoldingLots(portfolioId, financialAssetKey);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, dateFormatOptions),
    [locale],
  );
  const quantityFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }),
    [locale],
  );

  const data = query.data;
  const isAverage = data?.costBasisMethod === "AVERAGE";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Text as="h3" className="text-sm font-medium text-muted-foreground">
          {t("lots")}
        </Text>
        {data ? (
          <Text variant="smallText" className="text-muted-foreground">
            {isAverage ? t("lots-method-average") : t("lots-method-fifo")}
          </Text>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="flex h-[120px] items-center justify-center">
          <Spinner />
        </div>
      ) : query.isError || !data ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
          <Text variant="smallText" className="text-muted-foreground">
            {t("lots-unavailable")}
          </Text>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/30 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("lots-open-quantity")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {quantityFormatter.format(data.openQuantity)}
              </dd>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("lots-average-cost")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount value={data.averageUnitCost} currency={currency} />
              </dd>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("lots-cost-basis")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount value={data.openCostBasis} currency={currency} />
              </dd>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("lots-realized-cost")}
              </dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                <Amount value={data.realizedCostBasis} currency={currency} />
              </dd>
            </div>
          </dl>

          {data.lots.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
              <Text variant="smallText" className="text-muted-foreground">
                {t("lots-empty")}
              </Text>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs">
                    <th className="py-2 pr-4 text-left font-medium">
                      {t("lots-date")}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t("lots-quantity")}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t("lots-remaining")}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t("lots-unit-cost")}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t("lots-fees")}
                    </th>
                    <th className="py-2 text-right font-medium">
                      {t("lots-status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.lots.map((lot) => (
                    <tr
                      key={`${lot.transactionKey ?? "pool"}:${lot.date}`}
                      className="border-border/70 border-t"
                    >
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {dateFormatter.format(new Date(lot.date))}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        {quantityFormatter.format(lot.quantity)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        {quantityFormatter.format(lot.remainingQuantity)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        <Amount value={lot.unitCost} currency={currency} />
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        <Amount value={lot.fees} currency={currency} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Badge
                          variant={lot.status === "OPEN" ? "outline" : "muted"}
                        >
                          {lot.status === "OPEN"
                            ? t("lots-status-open")
                            : t("lots-status-closed")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
