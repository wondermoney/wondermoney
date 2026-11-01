import type {
  PortfolioImportSessionPreviewResponse,
  PortfolioImportSessionStatus,
} from "@/lib/api/portfolio/importSessionTypes";

export type PortfolioImportStep =
  | "upload"
  | "analyzing"
  | "columnMapping"
  | "preview"
  | "assetReview"
  | "confirm"
  | "terminal";

export type PortfolioImportPhase = "upload" | "review" | "import";

type PortfolioImportSummary = PortfolioImportSessionPreviewResponse["summary"];
type PortfolioImportLedgerSummary = Pick<
  PortfolioImportSummary,
  | "canConfirm"
  | "terminalKind"
  | "unsupportedAssets"
  | "userSkippedRows"
  | "totalRows"
  | "readyRows"
  | "duplicateRows"
  | "invalidRows"
  | "needsAssetReviewRows"
  | "skippedRows"
  | "importedRows"
  | "failedRows"
>;

type PortfolioImportFailureSummary = PortfolioImportLedgerSummary &
  Pick<PortfolioImportSummary, "failureReason">;

type PortfolioImportTerminalKind = PortfolioImportSummary["terminalKind"];

export function getPortfolioImportTerminalKind(
  summary?: Pick<PortfolioImportSummary, "terminalKind"> | null,
): PortfolioImportTerminalKind {
  return summary?.terminalKind;
}

export function resolvePortfolioImportStep(
  status?: PortfolioImportSessionStatus,
): PortfolioImportStep {
  switch (status) {
    case "uploaded":
      return "upload";
    case "parsing":
      return "analyzing";
    case "needs_column_mapping":
      return "columnMapping";
    case "needs_asset_review":
      return "assetReview";
    case "ready_to_import":
      return "confirm";
    case "importing":
    case "succeeded":
    case "failed":
    case "cancelled":
    case "expired":
      return "terminal";
    case "partial":
      return "preview";
    case "waiting_for_upload":
    default:
      return "upload";
  }
}

export function getPortfolioImportPhase(
  step: PortfolioImportStep,
): PortfolioImportPhase {
  switch (step) {
    case "upload":
    case "analyzing":
      return "upload";
    case "columnMapping":
    case "preview":
    case "assetReview":
      return "review";
    case "confirm":
    case "terminal":
      return "import";
  }
}

export function getPortfolioImportPhaseLabelKey(
  phase: PortfolioImportPhase,
):
  | "portfolio-import-phase-upload"
  | "portfolio-import-phase-review"
  | "portfolio-import-phase-import" {
  switch (phase) {
    case "upload":
      return "portfolio-import-phase-upload";
    case "review":
      return "portfolio-import-phase-review";
    case "import":
      return "portfolio-import-phase-import";
  }
}

export function resolvePortfolioImportVisibleStep({
  status,
  isFinalizing = false,
  hasObservedImporting = false,
  summary,
}: {
  isFinalizing?: boolean;
  hasObservedImporting?: boolean;
  status?: PortfolioImportSessionStatus;
  summary?: PortfolioImportLedgerSummary | null;
}): PortfolioImportStep {
  if (status === "partial") {
    const terminalKind = getPortfolioImportTerminalKind(summary);

    if (terminalKind || isDuplicateOnlyResult(summary ?? undefined)) {
      return "terminal";
    }

    if (
      isFinalizing &&
      (hasObservedImporting || isPostImportPartialResult(summary ?? undefined))
    ) {
      return "terminal";
    }

    return canConfirmPortfolioImport(status, summary) ? "confirm" : "preview";
  }

  return resolvePortfolioImportStep(status);
}

export function canConfirmPortfolioImport(
  status?: PortfolioImportSessionStatus,
  summary?: PortfolioImportLedgerSummary | null,
): boolean {
  if (summary?.canConfirm !== undefined) return summary.canConfirm;
  if (status === "ready_to_import") return true;
  return (
    status === "partial" &&
    (summary?.readyRows ?? 0) > 0 &&
    (summary?.needsAssetReviewRows ?? 0) === 0
  );
}

export function isDuplicateOnlyResult(
  summary?: PortfolioImportLedgerSummary,
): boolean {
  if (!summary) return false;
  return (
    ((summary.skippedRows ?? 0) > 0 || (summary.duplicateRows ?? 0) > 0) &&
    (summary.importedRows ?? 0) === 0 &&
    (summary.failedRows ?? 0) === 0 &&
    (summary.readyRows ?? 0) === 0 &&
    (summary.invalidRows ?? 0) === 0 &&
    (summary.needsAssetReviewRows ?? 0) === 0
  );
}

export function isPostImportPartialResult(
  summary?: PortfolioImportLedgerSummary | null,
): boolean {
  if (!summary) return false;
  return (summary.importedRows ?? 0) > 0 || (summary.failedRows ?? 0) > 0;
}

export function getPortfolioImportTerminalFailureReason(preview?: {
  status?: PortfolioImportSessionStatus;
  summary?: PortfolioImportFailureSummary | null;
}): string | undefined {
  const status = preview?.status;
  if (status !== "failed" && status !== "cancelled" && status !== "expired") {
    return undefined;
  }

  const reason = preview?.summary?.failureReason?.trim();
  if (!reason) return undefined;

  const looksLikeMessageKey =
    /^portfolio-import-[a-z0-9-.]+$/i.test(reason) ||
    /^[a-z][a-z0-9.-]*\.[a-z0-9.-]+$/i.test(reason);
  const looksTooTechnical = /[{}()[\]<>]/.test(reason) || reason.length > 140;

  return looksLikeMessageKey || looksTooTechnical ? undefined : reason;
}

export function hasBlockingAssetReview(
  preview?: PortfolioImportSessionPreviewResponse | null,
): boolean {
  if (!preview) return false;
  return (
    preview.summary.needsAssetReviewRows > 0 ||
    preview.rows.needsAssetReview.length > 0 ||
    preview.assetGroups.some(
      (group) =>
        group.status === "ambiguous" ||
        group.status === "provider_error" ||
        group.status === "unmatched",
    )
  );
}

export function getPortfolioImportLedgerCounts(
  summary?: PortfolioImportLedgerSummary | null,
): {
  total: number;
  ready: number;
  duplicates: number;
  invalid: number;
  review: number;
  skipped: number;
  imported: number;
  failed: number;
} {
  return {
    total: summary?.totalRows ?? 0,
    ready: summary?.readyRows ?? 0,
    duplicates: summary?.duplicateRows ?? 0,
    invalid: summary?.invalidRows ?? 0,
    review: summary?.needsAssetReviewRows ?? 0,
    skipped: summary?.userSkippedRows ?? summary?.skippedRows ?? 0,
    imported: summary?.importedRows ?? 0,
    failed: summary?.failedRows ?? 0,
  };
}
