"use client";

import { Download, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/ui/FileUploader";
import { useImportManualAssets } from "@/lib/api/manual-asset/useManualAssetMutations";
import { calendarDay } from "@/lib/manual-assets/asset-view";
import {
  buildManualAssetTemplateCsv,
  type ManualAssetImportParseResult,
  parseManualAssetsCsv,
} from "@/lib/manual-assets/manual-asset-csv";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

const MAX_FILE_BYTES = 1024 * 1024;

function downloadTemplate() {
  const blob = new Blob([buildManualAssetTemplateCsv()], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wondermoney-manual-assets-template.csv";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface ManualAssetImportFlowProps {
  onClose: () => void;
  /** Called with how many assets the file created. */
  onImported?: (count: number) => void;
}

/**
 * A manual-assets file (the template's name, kind, value, valuation date, currency and private
 * columns) read in the browser, checked row by row, and created in one request: every asset with
 * its first valuation, or none. Each asset is the importer's and shared with the household unless
 * its row says private, as when it is added by hand.
 */
export function ManualAssetImportFlow({ onClose, onImported }: ManualAssetImportFlowProps) {
  const t = useTranslations("assets.import");
  const tKinds = useTranslations("assets.kinds");
  const locale = useLocale();
  const formatShortDate = useFormatShortDate();
  const importAssets = useImportManualAssets();
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ManualAssetImportParseResult>();
  const [importedCount, setImportedCount] = useState<number>();
  const [failed, setFailed] = useState(false);

  const onFileChange = async (next: File[]) => {
    setFiles(next);
    setFailed(false);
    const file = next[0];
    if (!file) {
      setParsed(undefined);
      return;
    }
    setParsed(parseManualAssetsCsv(await file.text(), { locale }));
  };

  const rows = parsed?.rows ?? [];
  const invalidRows = rows.filter((row) => row.issues.length > 0);
  const validRows = rows.flatMap((row) => (row.row ? [row.row] : []));
  const canImport =
    parsed !== undefined &&
    parsed.fileIssues.length === 0 &&
    invalidRows.length === 0 &&
    validRows.length > 0;

  const onImport = async () => {
    if (!canImport) return;
    setFailed(false);
    try {
      const created = await importAssets.mutateAsync(validRows);
      setImportedCount(created.length);
      onImported?.(created.length);
    } catch {
      setFailed(true);
    }
  };

  if (importedCount !== undefined) {
    return (
      <section role="status" aria-live="polite" className="flex flex-col gap-4">
        <div className="space-y-1">
          <h3 className="text-foreground text-base font-semibold tracking-tight">
            {t("done-title")}
          </h3>
          <p className="text-muted-foreground text-sm leading-6">
            {t("done-description", { count: importedCount })}
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="space-y-1">
        <h3 className="text-foreground text-base font-semibold tracking-tight">
          {t("title")}
        </h3>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {t("description")}
        </p>
      </div>

      <div>
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          <Download className="size-4" aria-hidden="true" />
          {t("download-template")}
        </Button>
        <p className="text-muted-foreground pt-2 text-xs leading-5">
          {t("columns-hint")}
        </p>
      </div>

      <FileUploader
        value={files}
        onValueChange={(next) => void onFileChange(next)}
        maxFileCount={1}
        maxSize={MAX_FILE_BYTES}
        accept={{ "text/csv": [".csv"] }}
        disabled={importAssets.isPending}
      />

      {parsed?.fileIssues.length ? (
        <Alert variant="destructive">
          <AlertTitle>{t("file-problem-title")}</AlertTitle>
          <AlertDescription>
            {parsed.fileIssues.map((issue) => (
              <p key={issue}>{t(`issues.${issue}`)}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {invalidRows.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            {t("rows-problem-title", { count: invalidRows.length })}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-6">
              {invalidRows.slice(0, 10).map((row) => (
                <li key={row.line}>
                  {t("row-problem", {
                    line: row.line,
                    problems: row.issues.map((issue) => t(`issues.${issue}`)).join(", "),
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {validRows.length > 0 && invalidRows.length === 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("preview-caption")}</caption>
            <thead className="text-muted-foreground text-xs">
              <tr className="border-b">
                <th scope="col" className="px-3 py-2 text-left font-medium">{t("column-name")}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{t("column-kind")}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{t("column-date")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("column-value")}</th>
              </tr>
            </thead>
            <tbody>
              {validRows.slice(0, 50).map((row, index) => (
                <tr key={`${row.name}-${index}`} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {row.name}
                      {row.isPrivate ? (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          <Lock className="size-3" aria-hidden="true" />
                          {t("private")}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2">{tKinds(row.kind)}</td>
                  <td className="text-muted-foreground px-3 py-2">
                    {row.valuationDate
                      ? formatShortDate(calendarDay(row.valuationDate))
                      : t("today")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Amount value={row.value} currency={row.currencyCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{t("failed")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={importAssets.isPending}>
          {t("close")}
        </Button>
        <Button
          type="button"
          onClick={() => void onImport()}
          loading={importAssets.isPending}
          disabled={!canImport || importAssets.isPending}
        >
          {t("action", { count: validRows.length })}
        </Button>
      </div>
    </section>
  );
}
