"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { getApiErrorCode } from "@/lib/api/errors";
import { isRateLimitError } from "@/lib/api/rate-limit";
import {
  DATA_EXPORT_PASSWORD_MIN_LENGTH,
  type DataExport as DataExportItem,
  dataExportPasswordLength,
  downloadStreamedDataExport,
  isDataExportPreparing,
  useLatestDataExport,
  useRefreshDataExports,
  useStartDataExport,
} from "@/lib/api/user/useDataExport";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Text } from "../ui/Typography";

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type PasswordProblem = "too-short" | "mismatch" | null;

function passwordProblem(password: string, confirmation: string): PasswordProblem {
  if (dataExportPasswordLength(password) < DATA_EXPORT_PASSWORD_MIN_LENGTH) {
    return "too-short";
  }
  return password === confirmation ? null : "mismatch";
}

/**
 * Settings > Privacy: export everything the member can see as a zip of JSON and CSV files,
 * optionally protected with a password (a WinZip AES-256 zip that 7-Zip, Keka or WinRAR open).
 *
 * With file storage the server prepares the file in the background (and emails when it is
 * ready); the row polls and then offers the download for 24 hours. Without storage the zip is
 * built while it downloads, so one click starts the download. The password is sent once, in the
 * request that starts the export, and cleared from the form straight after.
 */
export default function DataExport() {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { data: latest } = useLatestDataExport();
  const start = useStartDataExport();
  const refresh = useRefreshDataExports();
  const [isDownloading, setIsDownloading] = useState(false);
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<PasswordProblem>(null);

  const clearPassword = () => {
    setPassword("");
    setConfirmation("");
    setProblem(null);
  };

  const downloadStreamed = async (dataExport: DataExportItem) => {
    setIsDownloading(true);
    try {
      saveBlob(await downloadStreamedDataExport(dataExport.id), dataExport.fileName);
    } catch {
      toast.error(t("privacy-data-export-failed"));
    } finally {
      setIsDownloading(false);
      void refresh();
    }
  };

  const onStart = async () => {
    if (protect) {
      const found = passwordProblem(password, confirmation);
      setProblem(found);
      if (found) return;
    }
    try {
      const dataExport = await start.mutateAsync(
        protect ? { password } : {},
      );
      clearPassword();
      setProtect(false);
      if (dataExport.delivery === "stream" && dataExport.status === "ready") {
        await downloadStreamed(dataExport);
      }
    } catch (error) {
      toast.error(
        t(
          isRateLimitError(error)
            ? "privacy-data-export-limit"
            : getApiErrorCode(error) === "data_export_in_progress"
              ? "privacy-data-export-in-progress"
              : "privacy-data-export-error",
        ),
      );
    }
  };

  const preparing = isDataExportPreparing(latest);
  const ready = latest?.status === "ready";
  const busy = start.isPending || isDownloading || preparing;
  const passwordError =
    problem === "too-short"
      ? t("privacy-data-export-password-too-short", {
          min: DATA_EXPORT_PASSWORD_MIN_LENGTH,
        })
      : problem === "mismatch"
        ? t("privacy-data-export-password-mismatch")
        : null;

  return (
    <div className="flex w-full max-w-md flex-col items-start gap-3">
      {ready && latest.delivery === "storage" && latest.downloadUrl ? (
        <>
          <Button asChild variant="default">
            <a href={latest.downloadUrl} download={latest.fileName}>
              {t("privacy-data-export-download")}
            </a>
          </Button>
          {latest.expiresAt ? (
            <Text variant="mutedText">
              {t("privacy-data-export-ready-until", {
                date: formatShortDateForLocale(latest.expiresAt, locale, {
                  withTime: true,
                }),
              })}
            </Text>
          ) : null}
        </>
      ) : ready && latest.delivery === "stream" ? (
        <Button
          type="button"
          variant="default"
          loading={isDownloading}
          onClick={() => void downloadStreamed(latest)}
        >
          {t("privacy-data-export-download")}
        </Button>
      ) : (
        <>
          {busy ? null : (
            <div className="flex flex-col gap-3 self-stretch">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-protect`}
                  checked={protect}
                  onCheckedChange={(checked) => {
                    setProtect(checked === true);
                    clearPassword();
                  }}
                />
                <Label htmlFor={`${id}-protect`}>
                  {t("privacy-data-export-protect")}
                </Label>
              </div>
              {protect ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-password`}>
                      {t("privacy-data-export-password")}
                    </Label>
                    <Input
                      id={`${id}-password`}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      aria-invalid={problem === "too-short"}
                      aria-describedby={`${id}-password-hint`}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-confirm`}>
                      {t("privacy-data-export-password-confirm")}
                    </Label>
                    <Input
                      id={`${id}-confirm`}
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      aria-invalid={problem === "mismatch"}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </div>
                  <Text variant="mutedText" id={`${id}-password-hint`}>
                    {t("privacy-data-export-password-hint", {
                      min: DATA_EXPORT_PASSWORD_MIN_LENGTH,
                    })}
                  </Text>
                  {passwordError ? (
                    <Text
                      variant="mutedText"
                      role="alert"
                      className="text-destructive-text"
                    >
                      {passwordError}
                    </Text>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            loading={busy}
            onClick={() => void onStart()}
          >
            {t("privacy-data-export-cta")}
          </Button>
        </>
      )}
      {latest?.encrypted && (ready || preparing) ? (
        <Text variant="mutedText">{t("privacy-data-export-protected")}</Text>
      ) : null}
      {preparing ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-export-preparing")}
        </Text>
      ) : null}
      {isDownloading ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-export-downloading")}
        </Text>
      ) : null}
      {latest?.status === "failed" && !busy ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-export-failed")}
        </Text>
      ) : null}
    </div>
  );
}
