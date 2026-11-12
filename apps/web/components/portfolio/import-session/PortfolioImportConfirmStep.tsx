"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";
import useConfirmPortfolioImportSession from "@/lib/api/portfolio/useConfirmPortfolioImportSession";
import {
  canConfirmPortfolioImport,
  getPortfolioImportLedgerCounts,
  hasHeldBackPositionRows,
} from "@/lib/portfolio/import-session-flow";

import { PortfolioImportExistingTradesPanel } from "./PortfolioImportExistingTradesPanel";
import { PortfolioImportUnsupportedAssetsAlert } from "./PortfolioImportUnsupportedAssetsAlert";

interface PortfolioImportConfirmStepProps {
  importSessionId: number;
  isFinalizing?: boolean;
  onChooseAnotherFile: () => void;
  onConfirmed: () => void | Promise<void>;
  /** Reloads the preview after a row is included or skipped again (positions files). */
  onPreviewRefetch?: () => Promise<unknown>;
  preview?: PortfolioImportSessionPreviewResponse;
  recovery?: ReactNode;
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </span>
  );
}

export function PortfolioImportConfirmStep({
  importSessionId,
  isFinalizing = false,
  onChooseAnotherFile,
  onConfirmed,
  onPreviewRefetch,
  preview,
  recovery,
}: PortfolioImportConfirmStepProps) {
  const t = useTranslations();
  const confirmImport = useConfirmPortfolioImportSession();
  const canConfirm = canConfirmPortfolioImport(
    preview?.status,
    preview?.summary,
  );
  const counts = getPortfolioImportLedgerCounts(preview?.summary);
  const skippedRows =
    preview?.summary?.userSkippedRows ?? preview?.summary?.skippedRows ?? 0;
  const visibleSkippedRows = skippedRows || counts.skipped;
  const hasVisibleCounts =
    counts.ready > 0 || counts.duplicates > 0 || counts.invalid > 0 || visibleSkippedRows > 0;

  const handleConfirm = async () => {
    if (!canConfirm) return;

    try {
      await confirmImport.mutateAsync({ importSessionId });
      await onConfirmed();
    } catch {
      toast.error(t("server-error"), { duration: 9000 });
    }
  };

  return (
    <section aria-live="polite" role="status" className="flex flex-col gap-3">
      {recovery}

      <div className="space-y-1">
        <h3
          data-portfolio-import-step-heading="true"
          className="text-foreground text-base font-semibold tracking-tight"
        >
          {t("portfolio-import-confirm-title")}
        </h3>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {t(
            preview?.importType === "positions"
              ? "portfolio-import-positions-confirm-description"
              : "portfolio-import-confirm-description",
          )}
        </p>
      </div>

      {hasVisibleCounts ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {counts.ready > 0 ? (
            <SummaryLine label={t("portfolio-import-summary-ready")} value={counts.ready} />
          ) : null}
          {counts.duplicates > 0 ? (
            <SummaryLine label={t("portfolio-import-ledger-duplicates")} value={counts.duplicates} />
          ) : null}
          {counts.invalid > 0 ? (
            <SummaryLine label={t("portfolio-import-ledger-invalid")} value={counts.invalid} />
          ) : null}
          {visibleSkippedRows > 0 ? (
            <SummaryLine label={t("portfolio-import-ledger-skipped")} value={visibleSkippedRows} />
          ) : null}
        </div>
      ) : null}

      <PortfolioImportUnsupportedAssetsAlert
        unsupportedAssets={preview?.summary.unsupportedAssets}
      />

      {/* Only a positions file holds rows back for existing trades. */}
      {preview?.importType === "positions" && (preview.rows.existingTrades?.length ?? 0) > 0 ? (
        <PortfolioImportExistingTradesPanel
          importSessionId={importSessionId}
          onPreviewRefetch={onPreviewRefetch ?? (() => Promise.resolve())}
          preview={preview}
        />
      ) : null}

      {!canConfirm ? (
        <Alert variant="warning" className="py-3">
          <AlertDescription>
            {t(
              hasHeldBackPositionRows(preview?.summary) && counts.ready === 0
                ? "portfolio-import-existing-trades-nothing-left"
                : "portfolio-import-confirm-blocked",
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={onChooseAnotherFile}
          disabled={confirmImport.isPending || isFinalizing}
        >
          {t("portfolio-import-confirm-choose-another-file")}
        </Button>

        <Button
          type="button"
          loading={confirmImport.isPending || isFinalizing}
          disabled={!canConfirm || confirmImport.isPending || isFinalizing}
          onClick={handleConfirm}
        >
          {t("portfolio-import-confirm-action")}
        </Button>
      </div>
    </section>
  );
}
