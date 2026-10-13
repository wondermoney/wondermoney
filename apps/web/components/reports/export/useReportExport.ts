"use client";

import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { useState } from "react";
import { toast } from "sonner";

export interface UseReportExportOptions<T extends Record<string, unknown>> {
  /**
   * Fetch the raw row data that will be turned into CSV (default), or a ready-made
   * CSV Blob from the API `.csv` endpoint when `format: "blob"`.
   */
  requestFn: (() => Promise<T[]>) | (() => Promise<Blob>);
  /** Output filename without extension; `.csv` is appended automatically. */
  filename: string;
  /** Optional ordered column list. Only used in row-based mode. */
  columns?: string[];
  /** Export mode. `"rows"` (default) serializes rows client-side; `"blob"` saves the Blob directly. */
  format?: "rows" | "blob";
  /** Optional callback fired after a successful download starts. */
  onSuccess?: () => void;
}

export interface UseReportExportResult {
  exportData: () => Promise<void>;
  isPending: boolean;
  error: Error | null;
}

/**
 * Shared CSV export lifecycle hook.
 *
 * Supports two modes:
 *
 * 1. `format: "rows"` (default) — fetches raw rows, converts them to RFC 4180 CSV
 *    with a UTF-8 BOM for Excel compatibility, then triggers a download.
 * 2. `format: "blob"` — fetches a ready-made `Blob` from the API `.csv` endpoint
 *    and saves it directly, avoiding any client-side re-serialization.
 *
 * Existing call sites that pass a row-based `requestFn` keep working unchanged.
 */
export function useReportExport<T extends Record<string, unknown>>({
  requestFn,
  filename,
  columns,
  format = "rows",
  onSuccess,
}: UseReportExportOptions<T>): UseReportExportResult {
  const t = useTranslations("reports.export");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const exportData = async () => {
    setIsPending(true);
    setError(null);

    try {
      const blob =
        format === "blob"
          ? await (requestFn as () => Promise<Blob>)()
          : await (async () => {
              const rows = await (requestFn as () => Promise<T[]>)();
              const csv = Papa.unparse(rows, {
                columns,
                newline: "\n",
              });
              // UTF-8 BOM so Excel opens the file with the correct encoding.
              return new Blob(["\uFEFF", csv], {
                type: "text/csv;charset=utf-8",
              });
            })();

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Keep the URL around briefly to allow the browser to start the download,
      // then revoke it to avoid leaking memory.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(t("success"));
      onSuccess?.();
    } catch (err) {
      const exportError =
        err instanceof Error ? err : new Error("Export failed");
      setError(exportError);
      toast.error(t("error"));
    } finally {
      setIsPending(false);
    }
  };

  return { exportData, isPending, error };
}
