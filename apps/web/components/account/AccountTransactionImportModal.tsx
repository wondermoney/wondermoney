"use client";

import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { FileUploader } from "@/components/ui/FileUploader";
import { Form, FormField, FormItem } from "@/components/ui/Form";
import { FormControl, FormLabel, FormMessage } from "@/components/ui/Form";
import { LearningTip } from "@/components/ui/learning-tip";
import {
  type AccountCsvImportSuccessCallback,
  notifyAccountCsvImportSuccess,
} from "@/lib/account/account-csv-import-completion";
import { Account } from "@/lib/api/account/useAccounts";
import useCreateAccountTransactionsCsvUrl from "@/lib/api/account/useCreateAccountTransactionsCsvUrl";
import useStartAccountCsvImport from "@/lib/api/account/useStartAccountCsvImport";
import { isTerminalBackgroundOperationStatus } from "@/lib/api/background-operation/backgroundOperation";
import { useBackgroundOperation } from "@/lib/api/background-operation/useBackgroundOperation";
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
  const successNotifiedForCorrelationRef = useRef<string | undefined>(undefined);
  const methods = useForm<FormProps>({
    defaultValues: { accountId: accounts[0].accountKey.toString(), files: [] },
  });
  const { clearErrors, handleSubmit, reset, setError } = methods;
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const useCreateAccountTransactionsCsvUrlMutation =
    useCreateAccountTransactionsCsvUrl();
  const useStartAccountCsvImportMutation = useStartAccountCsvImport();
  const backgroundOperationQuery = useBackgroundOperation(correlationId);

  useEffect(() => {
    const status = backgroundOperationQuery.data?.status;
    if (status) setActiveImportStatus(status);
  }, [backgroundOperationQuery.data?.status]);

  useEffect(() => {
    notifyAccountCsvImportSuccess({
      authoritativeCorrelationId:
        backgroundOperationQuery.data?.correlationId,
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
            if (!uploadResponse.data.isSupportedBank) {
              posthog.capture("account-transactions-import-failure", {
                reason: "unsupported_bank",
              });
              toast.error(
                t("toast-import-transactions-error-unsupported-bank"),
                {
                  duration: 5000,
                },
              );
              setIsSubmitButtonLoading(false);
              setCorrelationId(undefined);
              setActiveImportStatus(undefined);
              terminalToastShownForCorrelationRef.current = undefined;
              return;
            }
            setActiveImportStatus("starting");
            const startResponse =
              await useStartAccountCsvImportMutation.mutateAsync({
                accountId: data.accountId,
                key: uploadResponse.data.key,
              });
            posthog.capture("account-transactions-import-started", {
              supportedBank: uploadResponse.data.isSupportedBank,
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
        // See AccountTransactionAddModal for why this isn't `trigger ?? <Button>`
        // (RAD-653): `null` must mean "no trigger", not "unset".
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
            onSubmit={handleSubmit(onSubmit)}
            id="import-account-transactions-form"
          >
            <FormField
              control={methods.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("account")}</FormLabel>
                  <FormControl>
                    <Select {...field} disabled={accounts.length === 1}>
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
                    accept={{
                      "text/csv": [".csv"],
                      "application/vnd.ms-excel": [".xls"],
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                        [".xlsx"],
                    }}
                    maxFileCount={1}
                    maxSize={1024 * 1024 * 10}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {visibleStatus ? (
          <div className="rounded-md border p-3 text-sm">
            <div>{visibleStatus}</div>
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

        <LearningTip className="mt-4">
          {t("import-transactions-adding-support-for-more-banks")}
        </LearningTip>
      </div>
    </DrawerDialog>
  );
};

export default AccountTransactionImportModal;
