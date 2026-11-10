"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { getApiErrorCode } from "@/lib/api/errors";
import { isRateLimitError } from "@/lib/api/rate-limit";
import {
  DATA_RESTORE_MAX_BYTES,
  type DataRestore as DataRestoreItem,
  type DataRestoreOverview,
  isDataRestoreBusy,
  useCommitDataRestore,
  useDataRestoreOverview,
  useReloadAfterRestore,
  useUploadDataRestore,
  useValidateDataRestore,
} from "@/lib/api/user/useDataRestore";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Text } from "../ui/Typography";

/** The rows of the summary, in the order a person thinks of them. */
const COUNTED = [
  "accounts",
  "transactions",
  "categories",
  "rules",
  "budgets",
  "goals",
  "loans",
  "portfolios",
  "portfolio-transactions",
] as const;

const PASSWORD_ERRORS = new Set(["password_required", "password_incorrect"]);

/** The restore worth showing: the latest, unless it has expired or was replaced. */
export function currentRestore(overview?: DataRestoreOverview | null) {
  const latest = overview?.restores[0];
  return latest && latest.status !== "expired" ? latest : null;
}

/** Whether to offer restore at all: while the household is empty, or while a restore is under way or just done. */
export function shouldOfferRestore(overview?: DataRestoreOverview | null) {
  if (!overview) return false;
  const current = currentRestore(overview);
  return (
    overview.availability.eligible ||
    current?.status === "restoring" ||
    current?.status === "restored"
  );
}

/**
 * Load a WonderMoney export (password protected or not) into the owner's empty household: pick
 * the zip, the server checks it and shows what it holds, then restore. The password, when asked
 * for, is sent once and cleared from the form straight after.
 */
export default function DataRestore({
  onRestored,
  restoredAction,
}: {
  /** Called once when a restore finishes. */
  onRestored?: () => void;
  /** What to offer once the data is back (a link onwards). */
  restoredAction?: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: overview } = useDataRestoreOverview();
  const upload = useUploadDataRestore();
  const validate = useValidateDataRestore();
  const commit = useCommitDataRestore();
  const reload = useReloadAfterRestore();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [choosingAnother, setChoosingAnother] = useState(false);
  const notifiedRef = useRef<string | null>(null);

  const restore = choosingAnother ? null : currentRestore(overview);

  useEffect(() => {
    if (restore?.status !== "restored" || notifiedRef.current === restore.id)
      return;
    notifiedRef.current = restore.id;
    void reload();
    onRestored?.();
  }, [onRestored, reload, restore]);

  if (!overview) return null;

  const onUpload = async () => {
    if (!file) return;
    setStartError(null);
    if (file.size > DATA_RESTORE_MAX_BYTES) {
      setStartError(t("privacy-data-restore-error-too_large"));
      return;
    }
    try {
      await upload.mutateAsync(file);
      setChoosingAnother(false);
    } catch (error) {
      setStartError(
        t(
          isRateLimitError(error)
            ? "privacy-data-restore-limit"
            : getApiErrorCode(error) === "household_not_empty"
              ? "privacy-data-restore-error-household_not_empty"
              : getApiErrorCode(error) === "data_restore_in_progress"
                ? "privacy-data-restore-in-progress"
                : "privacy-data-restore-start-error",
        ),
      );
    }
  };

  const onUnlock = async (current: DataRestoreItem) => {
    if (!password) return;
    try {
      await validate.mutateAsync({ id: current.id, password });
    } catch {
      setStartError(t("privacy-data-restore-start-error"));
    } finally {
      setPassword("");
    }
  };

  const onCommit = async (current: DataRestoreItem) => {
    try {
      await commit.mutateAsync(current.id);
    } catch (error) {
      setStartError(
        t(
          getApiErrorCode(error) === "household_not_empty"
            ? "privacy-data-restore-error-household_not_empty"
            : "privacy-data-restore-start-error",
        ),
      );
    }
  };

  const chooseAnother = () => {
    setChoosingAnother(true);
    setFile(null);
    setPassword("");
    setStartError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const busy = upload.isPending || isDataRestoreBusy(restore);
  const needsPassword =
    restore?.status === "invalid" &&
    PASSWORD_ERRORS.has(restore.error?.code ?? "");
  const showPicker =
    !restore ||
    ((restore.status === "invalid" || restore.status === "failed") &&
      !needsPassword) ||
    restore.status === "awaiting_upload";

  const errorText = (current: DataRestoreItem) => {
    const error = current.error;
    if (!error) return null;
    return t(`privacy-data-restore-error-${error.code}`, {
      file: error.file ?? "",
      values: (error.values ?? []).join(", "),
    });
  };

  return (
    <div className="flex w-full max-w-md flex-col items-start gap-3">
      {restore &&
      (restore.status === "invalid" || restore.status === "failed") ? (
        <Text
          variant="mutedText"
          role="alert"
          className="text-destructive-text"
        >
          {errorText(restore)}
        </Text>
      ) : null}

      {startError ? (
        <Text
          variant="mutedText"
          role="alert"
          className="text-destructive-text"
        >
          {startError}
        </Text>
      ) : null}

      {showPicker && !busy ? (
        <div className="flex flex-col gap-3 self-stretch">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-file`}>
              {t("privacy-data-restore-choose")}
            </Label>
            <Input
              ref={fileInput}
              id={`${id}-file`}
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setStartError(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={!file}
            onClick={() => void onUpload()}
          >
            {t("privacy-data-restore-cta")}
          </Button>
        </div>
      ) : null}

      {upload.isPending ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-restore-uploading")}
        </Text>
      ) : null}

      {restore?.status === "validating" ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-restore-validating")}
        </Text>
      ) : null}

      {needsPassword ? (
        <form
          className="flex flex-col gap-3 self-stretch"
          onSubmit={(event) => {
            event.preventDefault();
            void onUnlock(restore);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-password`}>
              {t("privacy-data-restore-password")}
            </Label>
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="default"
              disabled={!password}
              loading={validate.isPending}
            >
              {t("privacy-data-restore-unlock")}
            </Button>
            <Button type="button" variant="ghost" onClick={chooseAnother}>
              {t("privacy-data-restore-choose-another")}
            </Button>
          </div>
        </form>
      ) : null}

      {restore &&
      (restore.status === "ready" ||
        restore.status === "restoring" ||
        restore.status === "restored") &&
      restore.summary ? (
        <div className="flex flex-col gap-3 self-stretch">
          <Text variant="mutedText">
            {t(
              restore.status === "restored"
                ? "privacy-data-restore-restored"
                : "privacy-data-restore-ready",
            )}
          </Text>
          {restore.export ? (
            <Text variant="mutedText">
              {t("privacy-data-restore-exported-at", {
                date: formatShortDateForLocale(
                  restore.export.exportedAt,
                  locale,
                  { withTime: true },
                ),
              })}
            </Text>
          ) : null}
          <dl className="border-border grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border p-3 text-sm">
            {COUNTED.map((name) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">
                  {t(`privacy-data-restore-count-${name}`)}
                </dt>
                <dd className="text-foreground text-right font-mono">
                  {restore.summary?.counts[name] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
          {restore.summary.warnings.length > 0 ? (
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              {restore.summary.warnings.map((warning) => (
                <li key={warning.code}>
                  {t(`privacy-data-restore-warning-${warning.code}`, {
                    count: warning.count,
                    values: warning.values.join(", "),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {restore?.status === "ready" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="default"
            loading={commit.isPending}
            onClick={() => void onCommit(restore)}
          >
            {t("privacy-data-restore-commit")}
          </Button>
          <Button type="button" variant="ghost" onClick={chooseAnother}>
            {t("privacy-data-restore-choose-another")}
          </Button>
        </div>
      ) : null}

      {restore?.status === "restoring" ? (
        <Text variant="mutedText" role="status">
          {t("privacy-data-restore-restoring")}
        </Text>
      ) : null}

      {restore?.status === "restored" ? restoredAction : null}
    </div>
  );
}
