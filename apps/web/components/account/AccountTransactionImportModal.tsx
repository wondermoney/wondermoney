"use client";

import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { FileUploader } from "@/components/ui/FileUploader";
import { Form, FormField, FormItem } from "@/components/ui/Form";
import { FormControl, FormLabel, FormMessage } from "@/components/ui/Form";
import type { AccountCsvImportSuccessCallback } from "@/lib/account/account-csv-import-completion";
import { isStatementMappingComplete } from "@/lib/account/statement-mapping";
import { Account } from "@/lib/api/account/useAccounts";
import useCreateAccountTransactionsCsvUrl from "@/lib/api/account/useCreateAccountTransactionsCsvUrl";
import usePreviewAccountCsvImport, {
  type StatementMapping,
  type StatementPreview as Preview,
} from "@/lib/api/account/usePreviewAccountCsvImport";
import { useFeature } from "@/lib/api/instance/useInstance";
import {
  type TransactionImportSession,
  useCreateTransactionImport,
} from "@/lib/api/transaction-import/useTransactionImport";
import useAiHidden from "@/lib/api/user-preferences/useAiHidden";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import {
  invalidateAccounts,
  invalidateTransactions,
} from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import StatementPreview from "./StatementPreview";
import TransactionImportReview from "./TransactionImportReview";

/** OFX/QFX, QIF and CAMT.053 are read by their own adapters, without the column preview a CSV statement needs. */
const isOfxFileName = (name: string) => /\.(ofx|qfx)$/i.test(name.trim());
const isQifFileName = (name: string) => /\.qif$/i.test(name.trim());
const isCamtFileName = (name: string) => /\.xml$/i.test(name.trim());

/** A file whose own format the API reads: no columns to preview. */
type FileFormat = "ofx" | "qif" | "camt053";

interface AccountTransactionImportModalProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  accounts: Account[];
  trigger?: React.ReactNode;
  onImportSuccess?: AccountCsvImportSuccessCallback;
}

interface FormProps {
  accountId: string;
  broker: string;
  files: File[];
}

const AccountTransactionImportModal: React.FC<
  AccountTransactionImportModalProps
> = ({ isOpen, setOpen, accounts, trigger, onImportSuccess }) => {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const canImportFiles = useFeature((features) => features.fileStorage);
  const aiHidden = useAiHidden();

  const posthog = usePostHog();
  const [isSubmitButtonLoading, setIsSubmitButtonLoading] = useState(false);
  // The staged import the file became: once set, the dialog shows its review.
  const [importId, setImportId] = useState<string | undefined>();
  const methods = useForm<FormProps>({
    defaultValues: { accountId: accounts[0].accountKey.toString(), files: [] },
  });
  const { clearErrors, handleSubmit, reset, setError } = methods;
  const selectedAccountId = useWatch({
    control: methods.control,
    name: "accountId",
  });
  const [files, setFiles] = useState<File[]>([]);
  // The uploaded file, how it reads, and the columns as the person last set them.
  const [uploadedKey, setUploadedKey] = useState<string | undefined>();
  const [fileFormat, setFileFormat] = useState<FileFormat | null>(null);
  const [preview, setPreview] = useState<Preview | undefined>();
  const [mapping, setMapping] = useState<StatementMapping | undefined>();
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | undefined>();
  // Only the latest read may land: an earlier, slower one would show stale columns.
  const readSequenceRef = useRef(0);
  const previewMutation = usePreviewAccountCsvImport();
  const queryClient = useQueryClient();
  const useCreateAccountTransactionsCsvUrlMutation =
    useCreateAccountTransactionsCsvUrl();
  const createImport = useCreateTransactionImport();

  /** The review's import ended: say how, and refresh what it changed. */
  const onImportFinished = useCallback(
    (session: TransactionImportSession) => {
      const imported =
        session.status === "succeeded" || session.status === "partial";
      const message =
        session.status === "succeeded"
          ? t("toast-import-transactions-success")
          : session.status === "partial"
            ? t("toast-import-transactions-partial")
            : t("toast-import-transactions-failed");
      toast[session.status === "succeeded" ? "success" : "error"](message, {
        duration: 5000,
      });
      if (!imported) return;
      void invalidateAccounts(queryClient);
      invalidateTransactions(queryClient);
      onImportSuccess?.();
    },
    [onImportSuccess, queryClient, t],
  );

  const clearFile = () => {
    readSequenceRef.current += 1;
    setFiles([]);
    setUploadedKey(undefined);
    setFileFormat(null);
    setPreview(undefined);
    setMapping(undefined);
    setIsReading(false);
    setReadError(undefined);
  };

  /** Reads the uploaded file, as found or with the person's columns, and shows the result. */
  const readFile = async (
    accountId: string,
    key: string,
    nextMapping?: StatementMapping,
  ) => {
    const sequence = ++readSequenceRef.current;
    setIsReading(true);
    setReadError(undefined);
    try {
      const response = await previewMutation.mutateAsync({
        accountId,
        key,
        mapping: nextMapping,
      });
      if (sequence !== readSequenceRef.current) return;
      setPreview(response.data);
      if (!nextMapping) setMapping(response.data.mapping);
    } catch (error) {
      if (sequence !== readSequenceRef.current) return;
      if (!notifyIfRateLimited(error))
        setReadError(t("import-statement-unreadable"));
      setPreview(undefined);
    } finally {
      if (sequence === readSequenceRef.current) setIsReading(false);
    }
  };

  /** Uploads the chosen file at once, so its preview is ready before the person presses Import. */
  const uploadAndRead = (file: File, accountId: string) => {
    const kind: FileFormat | null = isOfxFileName(file.name) ? "ofx" : isQifFileName(file.name) ? "qif" : isCamtFileName(file.name) ? "camt053" : null;
    const sequence = ++readSequenceRef.current;
    setIsReading(true);
    setReadError(undefined);
    setPreview(undefined);
    setMapping(undefined);
    setUploadedKey(undefined);
    setFileFormat(kind);
    useCreateAccountTransactionsCsvUrlMutation.mutate(
      { accountId },
      {
        onSuccess: async (uploadResponse) => {
          try {
            await axios.put(uploadResponse.data.presignedUrl, file, {
              headers: {
                "Content-Type":
                  kind === "ofx"
                    ? "application/x-ofx"
                    : kind === "qif"
                      ? "application/x-qif"
                      : kind === "camt053"
                        ? "application/xml"
                        : "text/csv",
              },
            });
          } catch {
            if (sequence !== readSequenceRef.current) return;
            setIsReading(false);
            setFileFormat(null);
            setReadError(t("toast-import-transactions-error"));
            posthog.capture("account-transactions-import-failure", {
              reason: "s3_upload_failed",
            });
            return;
          }
          if (sequence !== readSequenceRef.current) return;
          setUploadedKey(uploadResponse.data.key);
          // OFX/QFX, QIF and CAMT.053 have no columns to preview: the review reads them.
          if (kind) {
            setIsReading(false);
            return;
          }
          await readFile(accountId, uploadResponse.data.key);
        },
        onError: (error) => {
          if (sequence !== readSequenceRef.current) return;
          setIsReading(false);
          setFileFormat(null);
          if (!notifyIfRateLimited(error))
            setReadError(t("toast-import-transactions-error"));
          posthog.capture("account-transactions-import-failure", {
            reason: "presigned_url_failed",
          });
        },
      },
    );
  };

  const onMappingChange = (nextMapping: StatementMapping) => {
    if (fileFormat) return;
    setMapping(nextMapping);
    if (uploadedKey && isStatementMappingComplete(nextMapping)) {
      void readFile(selectedAccountId, uploadedKey, nextMapping);
    }
  };

  const resetAll = () => {
    reset();
    clearFile();
    setIsSubmitButtonLoading(false);
    setImportId(undefined);
  };

  const canImport =
    !!uploadedKey &&
    !isReading &&
    (fileFormat !== null ||
      (!!preview &&
        preview.totalRows > 0 &&
        (preview.source === "bank" || isStatementMappingComplete(mapping))));

  /** Stage the uploaded file as an import and open its review; nothing is imported yet. */
  const onSubmit = async (data: FormProps) => {
    if (!files[0]) {
      setError("files", {
        type: "required",
        message: t("toast-import-transactions-error-no-file"),
      });
      return;
    }
    if (!canImport || !uploadedKey) return;

    setIsSubmitButtonLoading(true);
    try {
      const session = await createImport.mutateAsync({
        accountId: data.accountId,
        fileName: files[0].name,
        format: fileFormat ?? "statement",
        key: uploadedKey,
        // The bank's own parser needs no columns; any other file reads as previewed.
        mapping:
          fileFormat || preview?.source === "bank" ? undefined : mapping,
      });
      posthog.capture("account-transactions-import-started", {
        kind: "account",
        source: fileFormat ?? preview?.source,
      });
      setImportId(session.id);
    } catch (error) {
      if (!notifyIfRateLimited(error)) {
        toast.error(t("toast-import-transactions-error"), { duration: 5000 });
      }
      posthog.capture("account-transactions-import-failure", {
        reason: "start_failed",
      });
    } finally {
      setIsSubmitButtonLoading(false);
    }
  };

  const isLoading = isSubmitButtonLoading || createImport.isPending;
  const reviewAccounts = accounts.filter(
    (account) => account.isOwnedByViewer !== false,
  );

  // CSV imports upload the file to storage first; a server without storage offers none.
  if (!canImportFiles) return null;

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        // A commit already started carries on in the background; the dialog only lets go of it.
        if (!open) resetAll();
        setOpen(open);
      }}
      trigger={
        // See AccountTransactionAddModal for why this isn't `trigger ?? <Button>`:
        // `null` must mean "no trigger", not "unset".
        trigger !== undefined ? (
          (trigger ?? undefined)
        ) : (
          <Button className="grow gap-2">
            <Download className="size-4" />
            {t("import-transactions")}
          </Button>
        )
      }
      title={t("import-transactions")}
      footer={
        importId ? undefined : (
          <Button
            size="lg"
            type="submit"
            loading={isLoading}
            disabled={isLoading || !canImport}
            form="import-account-transactions-form"
          >
            {t("import-review-start")}
          </Button>
        )
      }
    >
      {importId ? (
        <TransactionImportReview
          accounts={reviewAccounts}
          importId={importId}
          onCancelled={resetAll}
          onFinished={onImportFinished}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Form {...methods}>
            <form
              className="w-full space-y-4"
              onSubmit={(event) => handleSubmit(onSubmit)(event)}
              id="import-account-transactions-form"
            >
              <FormField
                control={methods.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("account")}</FormLabel>
                    <FormControl>
                      {/* Radix Select reports a choice through onValueChange, not onChange: spreading
                        `field` left the form on the first account whatever was picked. */}
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          // The upload belongs to the account it was made for.
                          if (files[0]) uploadAndRead(files[0], value);
                        }}
                        disabled={accounts.length === 1}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("account")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {accounts.map((account) => (
                              <SelectItem
                                key={account.accountKey}
                                value={account.accountKey.toString()}
                              >
                                {account.accountName ?? t("unknown")}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={methods.control}
                name="files"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t("upload-transaction-file")}
                    </FormLabel>
                    <p className="text-muted-foreground text-sm">
                      {t("import-statement-hint")}
                    </p>
                    <FileUploader
                      value={files}
                      onValueChange={(nextFiles) => {
                        field.onChange(nextFiles);
                        if (!nextFiles[0]) {
                          clearFile();
                          return;
                        }
                        setFiles(nextFiles);
                        clearErrors("files");
                        uploadAndRead(nextFiles[0], selectedAccountId);
                      }}
                      accept={{
                        "text/csv": [".csv"],
                        "text/plain": [".txt", ".qif"],
                        "application/vnd.ms-excel": [".xls"],
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                          [".xlsx"],
                        "application/x-ofx": [".ofx", ".qfx"],
                        "application/qif": [".qif"],
                        "application/x-qif": [".qif"],
                        "application/xml": [".ofx", ".qfx", ".xml"],
                        "text/xml": [".ofx", ".qfx", ".xml"],
                        "application/octet-stream": [".ofx", ".qfx", ".qif", ".xml"],
                      }}
                      maxFileCount={1}
                      // The API reads at most 5 MB (DEFAULT_CSV_UPLOAD_LIMITS); a larger file would upload and then fail.
                      maxSize={1024 * 1024 * 5}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>

          {isReading && !preview ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {t("import-statement-reading")}
            </p>
          ) : null}
          {fileFormat && !isReading ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {fileFormat === "qif"
                ? t("import-qif-ready")
                : fileFormat === "camt053"
                  ? t("import-camt-ready")
                  : t("import-ofx-ready")}
            </p>
          ) : null}
          {readError ? (
            <p className="text-destructive-text text-sm" role="alert">
              {readError}
            </p>
          ) : null}
          {preview ? (
            <StatementPreview
              aiHidden={aiHidden}
              disabled={isReading || isLoading}
              mapping={mapping}
              onMappingChange={onMappingChange}
              preview={preview}
            />
          ) : null}
        </div>
      )}
    </DrawerDialog>
  );
};

export default AccountTransactionImportModal;
