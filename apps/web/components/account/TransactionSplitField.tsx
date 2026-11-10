"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Split } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CategoryCellContent } from "@/components/CategorySelect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import CategoryIcon from "@/components/ui/CategoryIcon";
import {
  amountToUnits,
  formatUnitsForInput,
  newSplitLineId,
  sameSplitDraft,
  type SplitDraftLine,
  type SplitSummary,
  summarizeSplit,
} from "@/lib/account/transaction-split";
import type { Transaction } from "@/lib/api/account/useTransactions";
import {
  invalidateTransactionSplits,
  isSplitTransaction,
  useRemoveTransactionSplits,
} from "@/lib/api/account/useTransactionSplits";
import type { Category } from "@/lib/api/category/useCategories";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";

import { TransactionSplitEditor } from "./TransactionSplitEditor";
import { useSplitCategoryLabel } from "./TransactionSplitLines";

/** The existing lines of a split transaction, as editable drafts. */
function draftFromSplits(
  transaction: Transaction,
  locale: string,
): SplitDraftLine[] {
  return [...(transaction.splits ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((line) => ({
      id: newSplitLineId(),
      categoryKey: line.category ? line.category.categoryKey.toString() : null,
      amount: formatUnitsForInput(amountToUnits(line.amount), locale),
      notes: line.notes ?? "",
    }));
}

export interface SplitDraft {
  /** The transaction was split when the sheet opened. */
  wasSplit: boolean;
  /** The editor is showing (a split, or one being started). */
  editing: boolean;
  lines: SplitDraftLine[];
  setLines: (lines: SplitDraftLine[]) => void;
  summary: SplitSummary;
  totalUnits: bigint;
  /** Saving would send `PUT .../splits`. */
  changed: boolean;
  /** Changed, but the lines cannot be saved yet. */
  blocked: boolean;
  start: () => void;
  cancel: () => void;
}

/**
 * The split being edited in the transaction sheet. `totalUnits` is what the lines must add up
 * to: the amount in the sheet's amount field, so an amount edit and a split save together.
 */
export function useSplitDraft(
  transaction: Transaction,
  totalUnits: bigint,
): SplitDraft {
  const locale = useLocale();
  const wasSplit = isSplitTransaction(transaction);
  const [initial] = useState(() =>
    wasSplit ? draftFromSplits(transaction, locale) : [],
  );
  const [editing, setEditing] = useState(wasSplit);
  const [lines, setLines] = useState<SplitDraftLine[]>(initial);
  const summary = useMemo(
    () => summarizeSplit(lines, totalUnits, locale),
    [lines, locale, totalUnits],
  );
  const changed = editing && (!wasSplit || !sameSplitDraft(lines, initial));

  return {
    wasSplit,
    editing,
    lines,
    setLines,
    summary,
    totalUnits,
    changed,
    blocked: changed && summary.problem !== null,
    // Two lines to start: the current category with the whole amount, and an empty one.
    start: () => {
      const current = transaction.appuserTransactionCategories[0];
      setLines([
        {
          id: newSplitLineId(),
          categoryKey: current ? current.categoryKey.toString() : null,
          amount: formatUnitsForInput(totalUnits, locale),
          notes: "",
        },
        { id: newSplitLineId(), categoryKey: null, amount: "", notes: "" },
      ]);
      setEditing(true);
    },
    cancel: () => {
      setLines(initial);
      setEditing(wasSplit);
    },
  };
}

/** The message for a failed `PUT .../splits`, by the API's error code. */
export function splitSaveErrorKey(
  error: unknown,
): "errors.invalid" | "errors.loan-repayment" | null {
  const code = getApiErrorCode(error);
  if (code === API_ERROR_CODE.SPLIT_INVALID) return "errors.invalid";
  if (code === API_ERROR_CODE.TRANSACTION_HAS_LOAN_REPAYMENT)
    return "errors.loan-repayment";
  return null;
}

interface TransactionSplitFieldProps {
  split: SplitDraft;
  transaction: Transaction;
  categories: Category[];
  /** The amount field holds a different amount from the saved one. */
  amountChanged: boolean;
  disabled?: boolean;
  /** After the split is removed; the sheet closes, as the row it was opened with is stale. */
  onRemoved: () => void;
}

/**
 * The category part of the edit sheet: the transaction's category with a "Split" action, or
 * the split editor, with "Remove split" for a split transaction.
 */
export function TransactionSplitField({
  split,
  transaction,
  categories,
  amountChanged,
  disabled = false,
  onRemoved,
}: TransactionSplitFieldProps) {
  const t = useTranslations("transactionSplit");
  const tRoot = useTranslations();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const categoryLabel = useSplitCategoryLabel();
  const removeSplits = useRemoveTransactionSplits();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const current = transaction.appuserTransactionCategories[0];
  const isLoanRepayment = Boolean(transaction.loanRepayment);
  const canSplit = !isLoanRepayment && split.totalUnits !== 0n;

  // The API keeps the largest line's category when a split is removed.
  const largestLine = [...(transaction.splits ?? [])].sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
  )[0];

  const onRemove = async () => {
    try {
      await removeSplits.mutateAsync(transaction.transactionKey);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("errors.remove"));
      return;
    } finally {
      setConfirmingRemove(false);
    }
    posthog.capture("transaction_split_removed");
    await invalidateTransactionSplits(queryClient, transaction.transactionKey);
    toast.success(t("removed"));
    onRemoved();
  };

  return (
    <section className="space-y-3" aria-labelledby="edit-transaction-split">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id="edit-transaction-split" className="text-sm font-medium">
          {split.editing ? t("lines") : tRoot("category")}
        </h3>
        {split.editing && !split.wasSplit ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={split.cancel}
          >
            {t("cancel")}
          </Button>
        ) : null}
        {split.wasSplit ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled || removeSplits.isPending}
            onClick={() => setConfirmingRemove(true)}
          >
            {t("remove")}
          </Button>
        ) : null}
      </div>

      {split.editing ? (
        <>
          <TransactionSplitEditor
            lines={split.lines}
            onLinesChange={split.setLines}
            summary={split.summary}
            totalUnits={split.totalUnits}
            currency={transaction.settlementCurrencyKey.code}
            categories={categories}
            disabled={disabled}
          />
          {split.blocked ? (
            <p className="text-muted-foreground text-xs">
              {split.summary.problem === "line-errors"
                ? t("needs-amounts")
                : t("save-blocked")}
            </p>
          ) : null}
          {split.wasSplit && !split.changed && amountChanged ? (
            <p className="text-muted-foreground text-xs">{t("rescale-hint")}</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <CategoryCellContent
              icon={current ? <CategoryIcon icon={current.icon} /> : undefined}
              iconColor={current?.bgColor}
              label={current ? categoryLabel(current) : "—"}
              muted={!current}
            />
            {canSplit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={split.start}
              >
                <Split className="size-4" aria-hidden />
                {t("split")}
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {isLoanRepayment ? t("loan-repayment") : t("split-hint")}
          </p>
        </>
      )}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("remove-description", {
                category: categoryLabel(largestLine?.category ?? null),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stay open while the request runs; `onRemove` closes it.
                event.preventDefault();
                void onRemove();
              }}
            >
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
