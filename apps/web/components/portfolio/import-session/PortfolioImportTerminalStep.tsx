"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";
import {
  getPortfolioImportTerminalFailureReason,
  getPortfolioImportTerminalKind,
  isDuplicateOnlyResult,
} from "@/lib/portfolio/import-session-flow";

import { PortfolioImportStatusBadge } from "./PortfolioImportStatusBadge";
import { PortfolioImportUnsupportedAssetsAlert } from "./PortfolioImportUnsupportedAssetsAlert";

interface PortfolioImportTerminalStepProps {
  onChooseAnotherFile?: () => void;
  onClose: () => void;
  preview?: PortfolioImportSessionPreviewResponse;
}

export function PortfolioImportTerminalStep({
  onChooseAnotherFile,
  onClose,
  preview,
}: PortfolioImportTerminalStepProps) {
  const t = useTranslations();
  const summary = preview?.summary;
  const status = preview?.status ?? "importing";
  const terminalKind = getPortfolioImportTerminalKind(summary);
  const duplicateOnly =
    terminalKind === "duplicate_only" ||
    (terminalKind === undefined && isDuplicateOnlyResult(summary));
  const failureReason = getPortfolioImportTerminalFailureReason(preview);
  const skippedRows = summary?.userSkippedRows ?? summary?.skippedRows ?? 0;

  const isFailedTerminalStatus =
    status === "failed" || status === "cancelled" || status === "expired";
  const hasVisibleCounts =
    (summary?.importedRows ?? 0) > 0 ||
    (summary?.skippedRows ?? 0) > 0 ||
    (summary?.failedRows ?? 0) > 0;

  if (isFailedTerminalStatus) {
    return (
      <section aria-live="polite" role="status" className="flex flex-col gap-3 text-center">
        <div className="flex min-h-32 flex-col items-center justify-center gap-2">
          <p className="text-foreground text-sm font-medium leading-6">
            {t("portfolio-import-terminal-failed")}
          </p>
          {failureReason ? (
            <p className="text-muted-foreground max-w-2xl text-sm leading-6">
              {t("portfolio-import-terminal-failure-reason", { reason: failureReason })}
            </p>
          ) : null}
        </div>

        <div className="flex justify-center">
          <Button type="button" variant="secondary" onClick={onChooseAnotherFile ?? onClose}>
            {t("portfolio-import-confirm-choose-another-file")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-live="polite" role="status" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p
            data-portfolio-import-step-heading="true"
            className="text-muted-foreground max-w-2xl text-sm leading-6"
          >
            {duplicateOnly
              ? t("portfolio-import-terminal-duplicate-only")
              : status === "partial"
                ? t("portfolio-import-terminal-partial")
                : status === "importing"
                  ? t("portfolio-import-terminal-importing")
                  : t("portfolio-import-terminal-success")}
          </p>
          {failureReason ? (
            <p className="text-muted-foreground max-w-2xl text-sm leading-6">
              {t("portfolio-import-terminal-failure-reason", { reason: failureReason })}
            </p>
          ) : null}
        </div>

        <PortfolioImportStatusBadge status={status} />
      </div>

      {!isFailedTerminalStatus && hasVisibleCounts ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {summary?.importedRows ? (
            <span>
              {t("portfolio-import-ledger-imported")} · {summary.importedRows}
            </span>
          ) : null}
          {skippedRows > 0 ? (
            <span>
              {t("portfolio-import-ledger-skipped")} · {skippedRows}
            </span>
          ) : null}
          {summary?.failedRows ? (
            <span>
              {t("portfolio-import-ledger-failed")} · {summary.failedRows}
            </span>
          ) : null}
        </div>
      ) : null}

      <PortfolioImportUnsupportedAssetsAlert
        unsupportedAssets={summary?.unsupportedAssets}
      />

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </section>
  );
}
