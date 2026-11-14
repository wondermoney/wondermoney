"use client";

import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ArrowLeft, Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import AiAllowanceNotice from "@/components/assistant/AiAllowanceNotice";
import EmailVerificationNotice from "@/components/auth/EmailVerificationNotice";
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
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isAiAllowanceExhaustedError,
  isEmailVerificationRequiredError,
} from "@/lib/api/errors";
import { useFeature, useStatementImport } from "@/lib/api/instance/useInstance";
import {
  type TransactionImportSession,
  useCancelTransactionImport,
  useCreatePdfTransactionImport,
  useCreateTransactionImport,
  useStartTransactionImportRead,
} from "@/lib/api/transaction-import/useTransactionImport";
import useStatementImportProvider from "@/lib/api/user/useStatementImportProvider";
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
type FileFormat = "ofx" | "qif" | "camt053" | "ynab" | "actual";

/**
 * Where the file comes from: a bank's statement (any format), a YNAB register, an Actual Budget
 * export, or a PDF statement read by the vision model.
 */
type ImportSource = "statement" | "ynab" | "actual" | "pdf";

/** A budgeting app's export: its own entry, guide and wording. */
type AppSource = Exclude<ImportSource, "statement" | "pdf">;

/** The copy each app's entry uses. */
const APP_COPY = {
  actual: {
    accountHint: "import-actual-account-hint",
    entry: "import-actual-entry",
    file: "import-actual-file",
    ready: "import-actual-ready",
    title: "import-actual-title",
  },
  ynab: {
    accountHint: "import-ynab-account-hint",
    entry: "import-ynab-entry",
    file: "import-ynab-file",
    ready: "import-ynab-ready",
    title: "import-ynab-title",
  },
} as const satisfies Record<AppSource, Record<string, string>>;

const isAppSource = (source: ImportSource): source is AppSource =>
  source === "ynab" || source === "actual";

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
  // PDF statements go to the vision model: offered only when the server has one for them and the
  // person has not hidden AI.
  const statementImport = useStatementImport();
  const pdfStatement = aiHidden ? null : statementImport;
  const format = useFormatter();
  // An AI gate the PDF import ran into: verify the email first, or wait for tomorrow's allowance.
  const [blockedBy, setBlockedBy] = useState<
    "allowance" | "verification" | null
  >(null);

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
  const [source, setSource] = useState<ImportSource>("statement");
  // Who the pages go to, from the signed-in profile: the public instance description never names it.
  const pdfProvider = useStatementImportProvider(
    source === "pdf" && !!pdfStatement,
  );
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
  const createPdfImport = useCreatePdfTransactionImport();
  const startRead = useStartTransactionImportRead();
  const cancelImport = useCancelTransactionImport();

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
    setBlockedBy(null);
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
    // A YNAB or Actual Budget export is a CSV whose columns the API knows: no columns to preview either.
    const kind: FileFormat | null = isAppSource(source)
      ? source
      : isOfxFileName(file.name)
        ? "ofx"
        : isQifFileName(file.name)
          ? "qif"
          : isCamtFileName(file.name)
            ? "camt053"
            : null;
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

  /** Switch between a bank statement and an app's export; a file picked for another is let go. */
  const chooseSource = (next: ImportSource) => {
    clearFile();
    methods.setValue("files", []);
    setSource(next);
  };

  const resetAll = () => {
    reset();
    clearFile();
    setSource("statement");
    setIsSubmitButtonLoading(false);
    setImportId(undefined);
  };

  const canImport =
    source === "pdf"
      ? !!files[0] && !!pdfStatement && files[0].size <= pdfStatement.maxBytes
      : !!uploadedKey &&
        !isReading &&
        (fileFormat !== null ||
          (!!preview &&
            preview.totalRows > 0 &&
            (preview.source === "bank" ||
              isStatementMappingComplete(mapping))));

  /**
   * A PDF statement: start its import (which spends one of the household's statement imports),
   * upload the PDF to the link it carries, and start the read. The review then shows each page as
   * the model reads it.
   */
  const startPdfImport = async (accountId: string, file: File) => {
    let session: TransactionImportSession;
    try {
      session = await createPdfImport.mutateAsync({
        accountId,
        contentLength: file.size,
        fileName: file.name,
      });
    } catch (error) {
      if (notifyIfRateLimited(error)) return;
      if (isEmailVerificationRequiredError(error)) setBlockedBy("verification");
      else if (isAiAllowanceExhaustedError(error)) setBlockedBy("allowance");
      else if (getApiErrorCode(error) === API_ERROR_CODE.STATEMENT_TOO_LARGE)
        setReadError(t("import-pdf-too-large"));
      else setReadError(t("toast-import-transactions-error"));
      return;
    }
    try {
      if (!session.upload) throw new Error("No upload link");
      await axios.put(session.upload.url, file, {
        headers: { "Content-Type": "application/pdf" },
      });
      await startRead.mutateAsync(session.id);
    } catch {
      // Nothing was read: close the import rather than leave it waiting.
      void cancelImport
        .mutateAsync({ id: session.id, input: undefined })
        .catch(() => undefined);
      setReadError(t("import-pdf-upload-failed"));
      posthog.capture("account-transactions-import-failure", {
        reason: "pdf_upload_failed",
      });
      return;
    }
    posthog.capture("account-transactions-import-started", {
      kind: "account",
      source: "pdf",
    });
    setImportId(session.id);
  };

  /** Stage the uploaded file as an import and open its review; nothing is imported yet. */
  const onSubmit = async (data: FormProps) => {
    if (!files[0]) {
      setError("files", {
        type: "required",
        message: t("toast-import-transactions-error-no-file"),
      });
      return;
    }
    if (source === "pdf") {
      if (!canImport) return;
      setIsSubmitButtonLoading(true);
      setReadError(undefined);
      try {
        await startPdfImport(data.accountId, files[0]);
      } finally {
        setIsSubmitButtonLoading(false);
      }
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
        mapping: fileFormat || preview?.source === "bank" ? undefined : mapping,
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

  const isLoading =
    isSubmitButtonLoading ||
    createImport.isPending ||
    createPdfImport.isPending;
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
      title={
        isAppSource(source)
          ? t(APP_COPY[source].title)
          : source === "pdf"
            ? t("import-pdf-title")
            : t("import-transactions")
      }
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
                          // The upload belongs to the account it was made for. A PDF uploads only on import.
                          if (files[0] && source !== "pdf")
                            uploadAndRead(files[0], value);
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
              {isAppSource(source) ? (
                <p className="text-muted-foreground -mt-2 text-sm">
                  {t(APP_COPY[source].accountHint)}
                </p>
              ) : null}
              <FormField
                control={methods.control}
                name="files"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {isAppSource(source)
                        ? t(APP_COPY[source].file)
                        : source === "pdf"
                          ? t("import-pdf-file")
                          : t("upload-transaction-file")}
                    </FormLabel>
                    {source === "ynab" ? (
                      <YnabExportGuide />
                    ) : source === "actual" ? (
                      <ActualExportGuide />
                    ) : source === "pdf" && pdfStatement ? (
                      <div
                        className="text-muted-foreground flex flex-col gap-1 text-sm"
                        data-testid="pdf-statement-consent"
                      >
                        <p>
                          {pdfProvider.data?.name
                            ? t("import-pdf-consent", {
                                provider: pdfProvider.data.name,
                              })
                            : t("import-pdf-consent-configured")}
                        </p>
                        <p>
                          {t("import-pdf-limits", {
                            pages: pdfStatement.maxPages,
                            size: format.number(
                              pdfStatement.maxBytes / (1024 * 1024),
                              {
                                maximumFractionDigits: 1,
                                style: "unit",
                                unit: "megabyte",
                              },
                            ),
                          })}
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t("import-statement-hint")}
                      </p>
                    )}
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
                        setReadError(undefined);
                        if (source !== "pdf")
                          uploadAndRead(nextFiles[0], selectedAccountId);
                      }}
                      accept={
                        isAppSource(source)
                          ? APP_EXPORT_ACCEPT
                          : source === "pdf"
                            ? PDF_ACCEPT
                            : STATEMENT_ACCEPT
                      }
                      maxFileCount={1}
                      // The API reads at most 5 MB (DEFAULT_CSV_UPLOAD_LIMITS); a larger file would upload and then
                      // fail. A PDF statement's limit is the server's own.
                      maxSize={
                        source === "pdf" && pdfStatement
                          ? pdfStatement.maxBytes
                          : 1024 * 1024 * 5
                      }
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>

          {blockedBy ? (
            blockedBy === "verification" ? (
              <EmailVerificationNotice />
            ) : (
              <AiAllowanceNotice />
            )
          ) : null}

          {source !== "statement" ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => chooseSource("statement")}
            >
              <ArrowLeft className="size-4" aria-hidden />
              {t("import-statement-back")}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-x-4">
              {pdfStatement ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="px-0"
                  onClick={() => chooseSource("pdf")}
                >
                  {t("import-pdf-entry")}
                </Button>
              ) : null}
              {(["ynab", "actual"] as const).map((app) => (
                <Button
                  key={app}
                  type="button"
                  variant="link"
                  size="sm"
                  className="px-0"
                  onClick={() => chooseSource(app)}
                >
                  {t(APP_COPY[app].entry)}
                </Button>
              ))}
            </div>
          )}

          {isReading && !preview ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {t("import-statement-reading")}
            </p>
          ) : null}
          {fileFormat && !isReading ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {fileFormat === "ynab" || fileFormat === "actual"
                ? t(APP_COPY[fileFormat].ready)
                : fileFormat === "qif"
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

/** A bank statement: CSV, Excel, OFX/QFX, QIF or CAMT.053 XML. */
const STATEMENT_ACCEPT = {
  "text/csv": [".csv"],
  "text/plain": [".txt", ".qif"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/x-ofx": [".ofx", ".qfx"],
  "application/qif": [".qif"],
  "application/x-qif": [".qif"],
  "application/xml": [".ofx", ".qfx", ".xml"],
  "text/xml": [".ofx", ".qfx", ".xml"],
  "application/octet-stream": [".ofx", ".qfx", ".qif", ".xml"],
};

/** A PDF bank statement, read by the vision model. */
const PDF_ACCEPT = { "application/pdf": [".pdf"] };

/** A YNAB register or Actual Budget export is a CSV (some systems label it plain text). */
const APP_EXPORT_ACCEPT = {
  "text/csv": [".csv"],
  "text/plain": [".csv"],
  "application/vnd.ms-excel": [".csv"],
};

/** How to get the register out of YNAB, in three short steps. */
function YnabExportGuide() {
  const t = useTranslations();
  return (
    <ol
      className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm"
      data-testid="ynab-export-guide"
    >
      <li>{t("import-ynab-guide-export")}</li>
      <li>{t("import-ynab-guide-unzip")}</li>
      <li>{t("import-ynab-guide-mapping")}</li>
    </ol>
  );
}

/** How to get the transactions out of Actual Budget, in three short steps. */
function ActualExportGuide() {
  const t = useTranslations();
  return (
    <ol
      className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm"
      data-testid="actual-export-guide"
    >
      <li>{t("import-actual-guide-export")}</li>
      <li>{t("import-actual-guide-file")}</li>
      <li>{t("import-actual-guide-mapping")}</li>
    </ol>
  );
}

export default AccountTransactionImportModal;
