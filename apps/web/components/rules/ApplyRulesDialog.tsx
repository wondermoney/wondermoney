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
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/Spinner";
import { isTerminalBackgroundOperationStatus } from "@/lib/api/background-operation/backgroundOperation";
import { useBackgroundOperation } from "@/lib/api/background-operation/useBackgroundOperation";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import {
  type RuleApplyProgress,
  type RuleApplyTarget,
  useApplyRules,
  useRuleApplicationCount,
} from "@/lib/api/rule/useRules";
import { invalidateSpendingTotals } from "@/lib/utils/queryInvalidation";

const progressOf = (
  progress: null | Record<string, unknown> | undefined,
): RuleApplyProgress | null =>
  progress &&
  typeof progress.processed === "number" &&
  typeof progress.total === "number" &&
  typeof progress.changed === "number"
    ? (progress as unknown as RuleApplyProgress)
    : null;

/**
 * Apply a rule (judged on its own) or every active rule to the household's
 * existing transactions: shows how many would change, asks to confirm, then
 * follows the background run and ends with a toast of how many changed.
 *
 * With `offer` (right after a rule is saved) nothing shows unless some
 * transactions would change. Mount it per use; `onClose` unmounts it. Closing
 * while it runs leaves the run going in the background.
 */
export function ApplyRulesDialog({
  target,
  ruleName,
  offer = false,
  onClose,
}: {
  target: RuleApplyTarget;
  /** The rule's name, when applying one rule. */
  ruleName?: string;
  offer?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("rules.apply");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const count = useRuleApplicationCount(target);
  const apply = useApplyRules();
  const [operationId, setOperationId] = useState<string>();
  const operation = useBackgroundOperation(operationId);
  const finished = useRef(false);

  const nothingToOffer =
    offer && (count.isError || (count.isSuccess && count.data === 0));
  useEffect(() => {
    if (nothingToOffer) onClose();
  }, [nothingToOffer, onClose]);

  const status = operation.data?.status;
  const progress = progressOf(operation.data?.progress);
  useEffect(() => {
    if (!isTerminalBackgroundOperationStatus(status) || finished.current)
      return;
    finished.current = true;
    if (status === "succeeded") {
      toast.success(t("done", { count: progress?.changed ?? 0 }));
    } else {
      toast.error(t("failed"));
    }
    void invalidateSpendingTotals(queryClient);
    onClose();
  }, [onClose, progress?.changed, queryClient, status, t]);

  const running = operationId !== undefined;
  const open = !(offer && (count.isPending || nothingToOffer));

  const onConfirm = async () => {
    try {
      setOperationId(await apply.mutateAsync(target));
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
      } else if (
        getApiErrorCode(error) === API_ERROR_CODE.RULE_APPLY_IN_PROGRESS
      ) {
        toast.error(t("in-progress"));
      } else {
        toast.error(t("error"));
      }
      onClose();
    }
  };

  const onDismiss = () => {
    if (running && !finished.current) {
      toast.info(t("continues"));
      // What changed so far shows at once; the rest when the lists refetch.
      void invalidateSpendingTotals(queryClient);
    }
    onClose();
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target === "all"
              ? t("all-title")
              : t("title", { name: ruleName ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {running ? (
                <>
                  <p>{t("running")}</p>
                  <Progress
                    value={percent}
                    aria-label={t("running")}
                    className="mt-3"
                  />
                  <p className="font-mono text-xs">
                    {progress
                      ? t("progress", {
                          processed: progress.processed,
                          total: progress.total,
                        })
                      : t("queued")}
                  </p>
                  <p className="text-xs">{t("background-hint")}</p>
                </>
              ) : count.isPending ? (
                <p className="flex items-center gap-2">
                  <Spinner />
                  {t("counting")}
                </p>
              ) : count.isError ? (
                <p role="alert">{t("count-error")}</p>
              ) : count.data === 0 ? (
                <p>{t("nothing")}</p>
              ) : (
                <>
                  <p>{t("description", { count: count.data })}</p>
                  <p className="text-xs">
                    {target === "all" ? t("all-scope-hint") : t("scope-hint")}
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {running || !count.data ? (
            <Button type="button" variant="secondary" onClick={onDismiss}>
              {t("close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onDismiss}>
                {offer ? t("not-now") : tRoot("cancel")}
              </Button>
              <Button
                type="button"
                loading={apply.isPending}
                disabled={apply.isPending}
                onClick={() => void onConfirm()}
              >
                {t("confirm", { count: count.data })}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
