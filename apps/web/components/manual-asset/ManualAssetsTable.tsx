"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import type { ManualAsset } from "@/lib/api/manual-asset/types";
import { calendarDay } from "@/lib/manual-assets/asset-view";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

type Cell = { row: { original: ManualAsset } };

/**
 * The household's assets, one per row: what it is, when it was last valued,
 * and its value in its own currency and in the viewer's. An archived asset
 * has no value today, so its row shows the last valuation instead.
 */
export default function ManualAssetsTable({
  assets,
  userCurrency,
  onRowClick,
}: {
  assets: ManualAsset[];
  userCurrency: string;
  onRowClick: (manualAssetKey: number) => void;
}) {
  const t = useTranslations("assets");
  const formatShortDate = useFormatShortDate();
  // The converted column only says something when some asset is in another currency.
  const hasForeign = assets.some((asset) => asset.currency !== userCurrency);

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("table.asset"),
        cell: ({ row }: Cell) => (
          <div className="min-w-40">
            <div className="text-foreground flex items-center gap-2 font-medium">
              <span className="truncate">{row.original.name}</span>
              {row.original.isPrivate ? (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                  <Lock className="size-3" aria-hidden="true" />
                  {t("table.private")}
                </span>
              ) : null}
            </div>
            <div className="text-muted-foreground text-sm">
              {t(`kinds.${row.original.kind}`)}
            </div>
          </div>
        ),
      },
      {
        id: "lastValued",
        header: t("table.lastValued"),
        cell: ({ row }: Cell) => (
          <span className="whitespace-nowrap">
            {row.original.lastValuation
              ? formatShortDate(calendarDay(row.original.lastValuation.date))
              : "—"}
          </span>
        ),
      },
      {
        id: "value",
        // A figure column's head sits over its figures, on the right.
        header: () => <div className="text-right">{t("table.value")}</div>,
        cell: ({ row }: Cell) => (
          <div className="text-right">
            <Amount
              value={
                row.original.archived
                  ? (row.original.lastValuation?.value ?? null)
                  : row.original.value
              }
              currency={row.original.currency}
              showCode={hasForeign}
              className="font-mono"
            />
          </div>
        ),
      },
      ...(hasForeign
        ? [
            {
              id: "valueInUserCurrency",
              header: () => (
                <div className="text-right">
                  {t("table.valueIn", { currency: userCurrency })}
                </div>
              ),
              cell: ({ row }: Cell) => (
                <div className="text-right">
                  {row.original.value !== null &&
                  row.original.valueInUserCurrency === null ? (
                    <span className="text-muted-foreground text-sm">
                      {t("table.noRate")}
                    </span>
                  ) : (
                    <Amount
                      value={row.original.valueInUserCurrency}
                      currency={userCurrency}
                      className="font-mono"
                    />
                  )}
                </div>
              ),
            },
          ]
        : []),
    ],
    [t, formatShortDate, hasForeign, userCurrency],
  );

  return (
    <Table
      columns={columns as any}
      data={assets}
      variant="ledger"
      withScrollAffordance
      onRowClick={(row) => onRowClick(row.original.manualAssetKey)}
    />
  );
}
