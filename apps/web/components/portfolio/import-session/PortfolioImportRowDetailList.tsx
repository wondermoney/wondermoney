"use client";

import { useTranslations } from "next-intl";

import type { PortfolioImportPreviewRow } from "@/lib/api/portfolio/importSessionTypes";

function formatRowReason(
  row: PortfolioImportPreviewRow,
  t: ReturnType<typeof useTranslations>,
) {
  return (
    row.skipReason ??
    row.failureReason ??
    (row.internalTransactionId
      ? t("portfolio-import-row-existing-transaction", {
          value: row.internalTransactionId,
        })
      : undefined)
  );
}

export function PortfolioImportRowDetailList({
  rows,
  emptyLabel,
}: {
  emptyLabel: string;
  rows: PortfolioImportPreviewRow[];
}) {
  const t = useTranslations();
  return rows.length ? (
    <ul className="grid gap-2">
      {rows.map((row) => {
        const rowReason = formatRowReason(row, t);

        return (
          <li key={row.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-foreground font-mono text-sm tabular-nums">
                {row.rowNumber}
              </div>
              {rowReason ? (
                <div className="text-muted-foreground text-sm leading-5">
                  {rowReason}
                </div>
              ) : null}
            </div>
            <div className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
              {row.assetGroupId ? `#${row.assetGroupId}` : "—"}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
      {emptyLabel}
    </div>
  );
}
