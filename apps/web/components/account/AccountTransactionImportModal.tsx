"use client";

import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Download, FileDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { FileUploader } from "@/components/ui/FileUploader";
import { Form, FormField, FormItem } from "@/components/ui/Form";
import { FormControl, FormLabel, FormMessage } from "@/components/ui/Form";
import { LearningTip } from "@/components/ui/learning-tip";
import {
  buildGenericCsvTemplate,
  GENERIC_CSV_COLUMNS,
  GENERIC_CSV_OPTIONAL_COLUMNS,
  GENERIC_CSV_TEMPLATE_FILENAME,
} from "@/lib/account/account-csv-generic-format";
import {
  type AccountCsvImportSuccessCallback,
  notifyAccountCsvImportSuccess,
} from "@/lib/account/account-csv-import-completion";
import { Account } from "@/lib/api/account/useAccounts";
import useCreateAccountTransactionsCsvUrl from "@/lib/api/account/useCreateAccountTransactionsCsvUrl";
import useStartAccountCsvImport from "@/lib/api/account/useStartAccountCsvImport";
import { isTerminalBackgroundOperationStatus } from "@/lib/api/background-operation/backgroundOperation";
import { useBackgroundOperation } from "@/lib/api/background-operation/useBackgroundOperation";
import useConfigs from "@/lib/api/configs/useConfigs";
import { useFeature } from "@/lib/api/instance/useInstance";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

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

  const posthog = usePostHog();
  const [isSubmitButtonLoading, setIsSubmitButtonLoading] = useState(false);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [activeImportStatus, setActiveImportStatus] = useState<
    string | undefined
  >();
  const terminalToastShownForCorrelationRef = useRef<string | undefined>(
    undefined,
  );
  const successNotifiedForCorrelationRef = useRef<string | undefined>(
    undefined,
  );
  const methods = useForm<FormProps>({
    defaultValues: { accountId: accounts[0].accountKey.toString(), files: [] },
  });
  const { clearErrors, handleSubmit, reset, setError } = methods;
  const selectedAccountId = useWatch({
    control: methods.control,
    name: "accountId",
  });
  const selectedAccount =
    accounts.find(
      (account) => account.accountKey.toString() === selectedAccountId,
    ) ?? accounts[0];
  // A supported bank's account reads the bank's own statement export; every other account
  // (another bank, or no bank at all) reads the generic CSV format described in the dialog.
  const importFormat = selectedAccount.csvImportFormat;
  const configsQuery = useConfigs({
    enabled: isOpen && importFormat === "generic",
  });
  const transactionTypes = configsQuery.data?.transactionTypes ?? [];
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const useCreateAccountTransactionsCsvUrlMutation =
    useCreateAccountTransactionsCsvUrl();
  const useStartAccountCsvImportMutation = useStartAccountCsvImport();
  const backgroundOperationQuery = useBackgroundOperation(correlationId);

  // Take each new status the background operation reports (adjusted during
  // render rather than in an effect). Handlers also set the status directly.
  const reportedStatus = backgroundOperationQuery.data?.status;
  const [prevReportedStatus, setPrevReportedStatus] =
    useState<typeof reportedStatus>(undefined);
  if (reportedStatus !== prevReportedStatus) {
    setPrevReportedStatus(reportedStatus);
    if (reportedStatus) setActiveImportStatus(reportedStatus);
  }

  useEffect(() => {
    notifyAccountCsvImportSuccess({
      authoritativeCorrelationId: backgroundOperationQuery.data?.correlationId,
      authoritativeStatus: backgroundOperationQuery.data?.status,
      correlationId,
      onSuccess: onImportSuccess,
      tracker: successNotifiedForCorrelationRef,
    });
  }, [
    backgroundOperationQuery.data?.correlationId,
    backgroundOperationQuery.data?.status,
    correlationId,
    onImportSuccess,
  ]);

  useEffect(() => {
    if (!isTerminalBackgroundOperationStatus(activeImportStatus)) return;
    if (terminalToastShownForCorrelationRef.current === correlationId) return;

    terminalToastShownForCorrelationRef.current = correlationId;
    const message =
      activeImportStatus === "succeeded"
        ? t("toast-import-transactions-success")
        : activeImportStatus === "partial"
          ? t("toast-import-transactions-partial")
          : activeImportStatus === "needs_action"
            ? t("toast-import-transactions-needs-action")
            : activeImportStatus === "stale"
              ? t("toast-import-transactions-stale")
              : t("toast-import-transactions-failed");

    toast[activeImportStatus === "succeeded" ? "success" : "error"](message, {
      duration: 5000,
    });
    void invalidateAccounts(queryClient);
  }, [activeImportStatus, correlationId, queryClient, t]);

  const isBackgroundImportActive =
    !!correlationId && !isTerminalBackgroundOperationStatus(activeImportStatus);

  const visibleStatus = useMemo(() => {
    switch (activeImportStatus) {
      case "uploading":
        return t("toast-import-transactions-uploading");
      case "starting":
        return t("toast-import-transactions-starting");
      case "queued":
        return t("toast-import-transactions-queued");
      case "running":
        return t("toast-import-transactions-running");
      case "succeeded":
        return t("toast-import-transactions-success");
      case "partial":
        return t("toast-import-transactions-partial");
      case "needs_action":
        return t("toast-import-transactions-needs-action");
      case "stale":
        return t("toast-import-transactions-stale");
      case "failed":
        return t("toast-import-transactions-failed");
      default:
        return null;
    }
  }, [activeImportStatus, t]);

  // The import's row counts, once the worker reports them, so a generic file with rows the API
  // rejected says how many and what to check.
  const progress = backgroundOperationQuery.data?.progress;
  const failedRows =
    typeof progress?.failed === "number" ? progress.failed : undefined;
  const totalRows =
    typeof progress?.totalRows === "number" ? progress.totalRows : undefined;
  const genericRowsFailedHint =
    importFormat === "generic" &&
    (activeImportStatus === "partial" || activeImportStatus === "failed") &&
    failedRows !== undefined &&
    failedRows > 0 &&
    totalRows !== undefined
      ? t("import-transactions-generic-rows-failed", {
          failed: failedRows,
          total: totalRows,
        })
      : null;

  const downloadGenericTemplate = () => {
    const blob = new Blob(
      ["\uFEFF", buildGenericCsvTemplate(transactionTypes)],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = GENERIC_CSV_TEMPLATE_FILENAME;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onCloseModal = async () => {
    setOpen(false);
    reset();
    setFiles([]);
    setIsSubmitButtonLoading(false);
    setCorrelationId(undefined);
    setActiveImportStatus(undefined);
    terminalToastShownForCorrelationRef.current = undefined;
    successNotifiedForCorrelationRef.current = undefined;
  };

  const onSubmit = (data: FormProps) => {
    if (!files[0]) {
      setError("files", {
        type: "required",
        message: t("toast-import-transactions-error-no-file"),
      });
      toast.error(t("toast-import-transactions-error-no-file"), {
        duration: 5000,
      });
      return;
    }
    if (importFormat === "generic" && !/\.csv$/i.test(files[0].name)) {
      setError("files", {
        type: "validate",
        message: t("import-transactions-generic-csv-only"),
      });
      return;
    }
    if (isBackgroundImportActive) return;

    terminalToastShownForCorrelationRef.current = undefined;
    setActiveImportStatus("uploading");
    setIsSubmitButtonLoading(true);
    useCreateAccountTransactionsCsvUrlMutation.mutate(
      { accountId: data.accountId },
      {
        onSuccess: async (uploadResponse) => {
          try {
            setActiveImportStatus("uploading");
            await axios.put(uploadResponse.data.presignedUrl, files[0], {
              headers: { "Content-Type": "text/csv" },
            });
            setActiveImportStatus("starting");
            const startResponse =
              await useStartAccountCsvImportMutation.mutateAsync({
                accountId: data.accountId,
                key: uploadResponse.data.key,
              });
            posthog.capture("account-transactions-import-started", {
              supportedBank: uploadResponse.data.isSupportedBank,
              format: importFormat,
              kind: "account",
            });
            setCorrelationId(startResponse.data.correlationId);
            setActiveImportStatus(startResponse.data.status);
            toast.success(t("toast-import-transactions-started"), {
              duration: 5000,
            });
            setIsSubmitButtonLoading(false);
          } catch {
            toast.error(t("toast-import-transactions-error"), {
              duration: 5000,
            });
            posthog.capture("account-transactions-import-failure", {
              reason: "s3_upload_failed",
            });
            setCorrelationId(undefined);
            setActiveImportStatus(undefined);
            terminalToastShownForCorrelationRef.current = undefined;
            setIsSubmitButtonLoading(false);
          }
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          toast.error(t("toast-import-transactions-error"), { duration: 5000 });
          posthog.capture("account-transactions-import-failure", {
            reason: "presigned_url_failed",
          });
          setCorrelationId(undefined);
          setActiveImportStatus(undefined);
          terminalToastShownForCorrelationRef.current = undefined;
          successNotifiedForCorrelationRef.current = undefined;
          setIsSubmitButtonLoading(false);
        },
      },
    );
  };

  const isLoading =
    isSubmitButtonLoading ||
    useCreateAccountTransactionsCsvUrlMutation.isPending ||
    useStartAccountCsvImportMutation.isPending ||
    isBackgroundImportActive;

  // CSV imports upload the file to storage first; a server without storage offers none.
  if (!canImportFiles) return null;

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBackgroundImportActive) {
          reset();
          setFiles([]);
          setIsSubmitButtonLoading(false);
          setCorrelationId(undefined);
          setActiveImportStatus(undefined);
          terminalToastShownForCorrelationRef.current = undefined;
        }
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
        <Button
          size="lg"
          type="submit"
          loading={isLoading}
          disabled={isLoading}
          form="import-account-transactions-form"
        >
          {t("import")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
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
                      onValueChange={field.onChange}
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
                  <FormLabel required>{t("upload-transaction-file")}</FormLabel>
                  <FileUploader
                    value={files}
                    onValueChange={(nextFiles) => {
                      setFiles(nextFiles);
                      field.onChange(nextFiles);
                      if (nextFiles[0]) clearErrors("files");
                    }}
                    accept={
                      importFormat === "generic"
                        ? { "text/csv": [".csv"] }
                        : {
                            "text/csv": [".csv"],
                            "application/vnd.ms-excel": [".xls"],
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                              [".xlsx"],
                          }
                    }
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

        {importFormat === "bank" ? (
          <LearningTip data-testid="account-import-bank-format">
            {t("import-transactions-bank-format", {
              bank:
                selectedAccount.accountFinancialInstitutionKey?.displayName ??
                t("unknown"),
            })}
          </LearningTip>
        ) : (
          <div
            className="space-y-3 rounded-md border p-3 text-sm"
            data-testid="account-import-generic-format"
          >
            <p>{t("import-transactions-generic-format")}</p>
            <dl className="space-y-1.5">
              {GENERIC_CSV_COLUMNS.map((column) => (
                <div key={column}>
                  <dt className="inline font-mono">{column}</dt>
                  {GENERIC_CSV_OPTIONAL_COLUMNS.has(column) ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({t("import-transactions-generic-optional")})
                    </span>
                  ) : null}
                  <dd className="text-muted-foreground">
                    {t(`import-transactions-generic-column-${column}`)}
                  </dd>
                </div>
              ))}
            </dl>
            <Button
              className="gap-2"
              onClick={downloadGenericTemplate}
              size="sm"
              type="button"
              variant="outline"
            >
              <FileDown className="size-4" />
              {t("import-transactions-generic-download-template")}
            </Button>
            {transactionTypes.length > 0 ? (
              <details className="group">
                <summary className="cursor-pointer font-medium">
                  {t("import-transactions-generic-type-codes")}
                </summary>
                <table className="mt-2 w-full text-left">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 pr-4 font-normal" scope="col">
                        {t("import-transactions-generic-type-code")}
                      </th>
                      <th className="py-1 font-normal" scope="col">
                        {t("transaction-type")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionTypes.map((type) => (
                      <tr key={type.transactionTypeKey}>
                        <td className="py-0.5 pr-4 font-mono">
                          {type.transactionTypeKey}
                        </td>
                        <td className="py-0.5">
                          {t(`transaction-type-${type.name}` as any)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </div>
        )}

        {visibleStatus ? (
          <div className="rounded-md border p-3 text-sm">
            <div>{visibleStatus}</div>
            {genericRowsFailedHint ? (
              <p className="text-muted-foreground mt-2">
                {genericRowsFailedHint}
              </p>
            ) : null}
            {isTerminalBackgroundOperationStatus(activeImportStatus) ? (
              <Button
                className="mt-3"
                onClick={onCloseModal}
                size="sm"
                type="button"
              >
                {t("close")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </DrawerDialog>
  );
};

export default AccountTransactionImportModal;
