"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import {
  accountRecalculationResultOf,
  useRecalculateAccount,
} from "@/lib/api/account/useRecalculateAccount";
import { isTerminalBackgroundOperationStatus } from "@/lib/api/background-operation/backgroundOperation";
import { useBackgroundOperation } from "@/lib/api/background-operation/useBackgroundOperation";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

/**
 * "Recalculate balances" for one account: says what it does, asks to
 * confirm, then follows the background run and ends with a toast of how many
 * rows it corrected and the balance before and after. Mount it per use;
 * `onClose` unmounts it. Closing while it runs leaves the run going.
 */
export function AccountRecalculateDialog({
  accountKey,
  accountName,
  onClose,
}: {
  accountKey: number;
  accountName: string;
  onClose: () => void;
}) {
  const t = useTranslations("accountRecalculate");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const formatCurrency = useFormatCurrency();
  const recalculate = useRecalculateAccount();
  const [operationId, setOperationId] = useState<string>();
  const operation = useBackgroundOperation(operationId);
  const finished = useRef(false);

  const status = operation.data?.status;
  const result = accountRecalculationResultOf(operation.data?.progress);
  useEffect(() => {
    if (!isTerminalBackgroundOperationStatus(status) || finished.current)
      return;
    finished.current = true;
    if (status === "succeeded" && result) {
      if (result.rowsChanged === 0) {
        toast.success(t("already-correct"));
      } else {
        const change =
          result.balanceBefore !== null && result.balanceAfter !== null
            ? t("balance-change", {
                before: formatCurrency(result.balanceBefore, result.currency),
                after: formatCurrency(result.balanceAfter, result.currency),
              })
            : undefined;
        toast.success(t("done", { count: result.rowsChanged }), {
          description: change,
        });
      }
    } else {
      toast.error(t("failed"));
    }
    void invalidateAccounts(queryClient);
    onClose();
  }, [formatCurrency, onClose, queryClient, result, status, t]);

  const running = operationId !== undefined;

  const onConfirm = async () => {
    try {
      setOperationId(await recalculate.mutateAsync(accountKey));
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
      } else if (
        getApiErrorCode(error) === API_ERROR_CODE.ACCOUNT_RECALCULATION_TOO_SOON
      ) {
        toast.error(t("too-soon"));
      } else {
        toast.error(t("error"));
      }
      onClose();
    }
  };

  const onDismiss = () => {
    if (running && !finished.current) toast.info(t("continues"));
    onClose();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { name: accountName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {running ? (
                <>
                  <p className="flex items-center gap-2" role="status">
                    <Spinner />
                    {t("running")}
                  </p>
                  <p className="text-xs">{t("background-hint")}</p>
                </>
              ) : (
                <>
                  <p>{t("description")}</p>
                  <p className="text-xs">{t("safe-hint")}</p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {running ? (
            <Button type="button" variant="secondary" onClick={onDismiss}>
              {t("close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onDismiss}>
                {tRoot("cancel")}
              </Button>
              <Button
                type="button"
                loading={recalculate.isPending}
                disabled={recalculate.isPending}
                onClick={() => void onConfirm()}
              >
                {t("confirm")}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
