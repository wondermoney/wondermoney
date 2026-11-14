"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Switch } from "@/components/ui/switch";
import type {
  PortfolioImportPreviewRow,
  PortfolioImportSessionPreviewResponse,
} from "@/lib/api/portfolio/importSessionTypes";
import useUpdatePortfolioImportRowInclusion from "@/lib/api/portfolio/useUpdatePortfolioImportRowInclusion";
import { useFormatNumber } from "@/lib/utils/useFormatNumber";

interface PortfolioImportExistingTradesPanelProps {
  importSessionId: number;
  onPreviewRefetch: () => Promise<unknown>;
  preview: PortfolioImportSessionPreviewResponse;
}

function rowAssetLabel(row: PortfolioImportPreviewRow) {
  const normalized = row.normalized ?? {};
  for (const key of ["ticker", "isin", "assetName"] as const) {
    const value = normalized[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function rowNumber(row: PortfolioImportPreviewRow, key: "quantity" | "unitPrice") {
  const value = row.normalized?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Positions files (the caller renders it only for one): the rows for assets the portfolio already trades. An opening buy on top of
 * those trades would count the holding twice, so they are skipped unless the person includes
 * them, one by one.
 */
export function PortfolioImportExistingTradesPanel({
  importSessionId,
  onPreviewRefetch,
  preview,
}: PortfolioImportExistingTradesPanelProps) {
  const t = useTranslations();
  const formatNumber = useFormatNumber();
  const updateInclusion = useUpdatePortfolioImportRowInclusion();
  const [pendingRowId, setPendingRowId] = useState<number>();
  const rows = preview.rows.existingTrades ?? [];
  const total = preview.summary.existingTradeRows ?? rows.length;

  if (rows.length === 0) return null;

  const onToggle = async (row: PortfolioImportPreviewRow, include: boolean) => {
    setPendingRowId(row.id);
    try {
      await updateInclusion.mutateAsync({ importSessionId, rows: [{ include, rowId: row.id }] });
      await onPreviewRefetch();
    } catch {
      toast.error(t("server-error"), { duration: 9000 });
    } finally {
      setPendingRowId(undefined);
    }
  };

  return (
    <Alert variant="warning" className="py-3">
      <AlertTitle>{t("portfolio-import-existing-trades-title", { count: total })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p className="text-sm leading-6">{t("portfolio-import-existing-trades-description")}</p>
        <ul className="divide-border/60 flex flex-col divide-y">
          {rows.map((row) => {
            const included = row.status === "ready";
            const label = rowAssetLabel(row) ?? t("portfolio-import-existing-trades-row", { row: row.rowNumber });
            const quantity = rowNumber(row, "quantity");
            const switchId = `existing-trades-row-${row.id}`;
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <label htmlFor={switchId} className="text-foreground block truncate text-sm font-medium">
                    {label}
                  </label>
                  <div className="text-muted-foreground text-xs">
                    {quantity === undefined
                      ? t("portfolio-import-existing-trades-row", { row: row.rowNumber })
                      : t("portfolio-import-existing-trades-quantity", { quantity: formatNumber(quantity), row: row.rowNumber })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground text-xs" aria-hidden="true">
                    {included ? t("portfolio-import-existing-trades-included") : t("portfolio-import-existing-trades-skipped")}
                  </span>
                  <Switch
                    id={switchId}
                    checked={included}
                    disabled={pendingRowId !== undefined}
                    aria-label={t("portfolio-import-existing-trades-include", { asset: label })}
                    onCheckedChange={(checked) => void onToggle(row, checked)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
