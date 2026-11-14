"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useRuleSuggestionPrompt } from "@/components/rules/useRuleSuggestionPrompt";
import { Text } from "@/components/ui/Typography";
import {
  invalidateAfterTransactionDelete,
  skippedBankSyncedIds,
  useDeleteTransactions,
} from "@/lib/api/account/useDeleteTransactions";
import useEditTransactions, {
  type TransactionEditRequest,
} from "@/lib/api/account/useEditTransactions";
import { Transaction } from "@/lib/api/account/useTransactions";
import { isSplitTransaction } from "@/lib/api/account/useTransactionSplits";
import useConfigs from "@/lib/api/configs/useConfigs";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import type { Tag } from "@/lib/api/tag/useTags";
import { useDisclosure } from "@/lib/utils/useDIsclosure";

import CategorySelect from "../CategorySelect";
import Slide from "../ui/Animations/Slide";
import { Button } from "../ui/button";
import { TransactionBulkDeleteDialog } from "./TransactionBulkDeleteDialog";
import { TransactionBulkTagMenu } from "./TransactionBulkTagMenu";
import { useConfirmReplaceSplit } from "./useConfirmReplaceSplit";

/** The API's cap on one bulk change or delete. */
export const BULK_TRANSACTION_LIMIT = 5000;

/**
 * "Select all N matching": offered once every row on the page is selected and
 * the list's filters match more rows than that. `filter` is the list's own
 * (`transactionSelectionFilter`), so the action covers exactly the rows the
 * list would show, loaded or not.
 */
export interface SelectAllMatching {
  total: number;
  filter: Record<string, string | boolean>;
  /** Whether hidden rows are in the list, so unhiding is possible. */
  includesHidden: boolean;
  selected: boolean;
  onSelect: () => void;
}

interface TransactionReviewControlProps {
  transactions: Transaction[];
  onResetSelection: () => void;
  selectAllMatching?: SelectAllMatching;
}

/** Real rows only: the synthetic "Initial balance" rows have negative keys. */
const isPersisted = (transaction: Transaction) =>
  transaction.transactionKey > 0;

const TransactionReviewControl: React.FC<TransactionReviewControlProps> = ({
  transactions,
  onResetSelection,
  selectAllMatching,
}) => {
  const t = useTranslations();
  const tb = useTranslations("transactionBulk");
  const posthog = usePostHog();
  const persisted = transactions.filter(isPersisted);
  const transactionIds = persisted.map((row) => row.transactionKey.toString());
  const allMatching = selectAllMatching?.selected === true;
  const selectedCount = allMatching
    ? selectAllMatching.total
    : persisted.length;
  // Every matching row: the server resolves the filter. Otherwise the loaded rows' ids.
  const scope: Pick<TransactionEditRequest, "filter" | "transactionIds"> =
    allMatching ? { filter: selectAllMatching.filter } : { transactionIds };
  const allTransactionsReviewed =
    !allMatching && persisted.every((row) => row.reviewed);
  const allTransactionsVisible =
    allMatching || persisted.every((row) => !row.hidden);
  const allTransactionsHidden = allMatching
    ? selectAllMatching.includesHidden
    : persisted.length > 0 && persisted.every((row) => row.hidden);
  const syncedIds = persisted
    .filter((row) => row.bankSynced === true)
    .map((row) => row.transactionKey);
  // Tags some selected row carries, offered for removal; unknown for every matching row.
  const carriedTagKeys = allMatching
    ? null
    : new Set(
        persisted.flatMap((row) => (row.tags ?? []).map((tag) => tag.tagKey)),
      );
  const [opened, { toggle }] = useDisclosure();
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (transactions.length > 0 && !opened) {
      toggle();
    }
    if (transactions.length === 0 && opened) {
      toggle();
    }
  }, [transactions.length, opened, toggle]);

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync } = useEditTransactions();
  const offerRuleSuggestion = useRuleSuggestionPrompt();
  const { mutateAsync: deleteTransactions, isPending: isDeleting } =
    useDeleteTransactions();
  const queryClient = useQueryClient();
  // Giving a split transaction one category removes its split, so that is asked first. The
  // picker remounts while asking, so a cancelled choice does not stay on screen.
  const { confirm: confirmReplaceSplit, dialog: replaceSplitDialog } =
    useConfirmReplaceSplit();
  const [categoryPickerKey, setCategoryPickerKey] = useState(0);

  const refresh = () =>
    Promise.all(
      [
        ["accounts-transactions"],
        ["accounts-transactions-infinite"],
        ["account-transactions"],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  const showError = (error: unknown, fallback: string) => {
    if (isDemoReadOnlyError(error)) {
      toast.error(t("demo-read-only-title"), {
        description: t("demo-read-only-description"),
      });
      return;
    }
    if (getApiErrorCode(error) === API_ERROR_CODE.BULK_SELECTION_TOO_LARGE) {
      toast.error(tb("too-large-error", { max: BULK_TRANSACTION_LIMIT }));
      return;
    }
    toast.error(fallback, { duration: 9000 });
  };

  /** Send one bulk change for the current selection, then refresh and close the bar. */
  const run = async (
    event: string,
    change: Omit<TransactionEditRequest, "filter" | "transactionIds">,
    successMessage: string,
  ) => {
    setIsSubmitting(true);
    posthog.capture(event, {
      transactionIds: allMatching ? undefined : transactionIds,
      allMatching,
      count: selectedCount,
      ...change,
    });
    try {
      const response = await mutateAsync({ ...scope, ...change });
      await refresh();
      onResetSelection();
      toast.success(successMessage);
      offerRuleSuggestion(response?.data);
      toggle();
    } catch (error) {
      showError(error, t("toast-edit-transaction-error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPickCategory = (value: string) => {
    if (persisted.some(isSplitTransaction)) {
      setCategoryPickerKey((key) => key + 1);
    }
    confirmReplaceSplit(
      persisted,
      () =>
        void run(
          "account_transaction_review_set_category",
          { categoryId: value, reviewed: true },
          t("transaction-reviewed"),
        ),
    );
  };

  const onAddTag = (tag: Tag) =>
    void run(
      "account_transactions_bulk_add_tag",
      { addTagIds: [tag.tagKey] },
      tb("tagged-toast", { name: tag.name }),
    );
  const onRemoveTag = (tag: Tag) =>
    void run(
      "account_transactions_bulk_remove_tag",
      { removeTagIds: [tag.tagKey] },
      tb("untagged-toast", { name: tag.name }),
    );

  const hideIds = async (ids: number[]) => {
    try {
      await mutateAsync({ transactionIds: ids, hidden: true });
      await refresh();
      toast.success(t("transaction-hidden-toast"));
    } catch (error) {
      showError(error, t("toast-edit-transaction-error"));
    }
  };

  const onDelete = async () => {
    posthog.capture("account_transactions_bulk_delete", {
      allMatching,
      count: selectedCount,
    });
    try {
      const result = await deleteTransactions(
        allMatching
          ? { filter: selectAllMatching.filter }
          : { transactionIds: persisted.map((row) => row.transactionKey) },
      );
      await invalidateAfterTransactionDelete(queryClient);
      setDeleteOpen(false);
      onResetSelection();
      toggle();
      toast.success(
        tb("deleted-toast", { count: result.deletedTransactionIds.length }),
      );
      const skipped = skippedBankSyncedIds(result);
      if (skipped.length > 0) {
        toast(tb("skipped-toast", { count: skipped.length }), {
          description: tb("skipped-description"),
          duration: 12000,
          action: {
            label: tb("hide-skipped"),
            onClick: () => void hideIds(skipped),
          },
        });
      }
    } catch (error) {
      if (getApiErrorCode(error) === API_ERROR_CODE.TRANSACTION_BANK_SYNCED) {
        toast.error(tb("delete-only-synced", { count: selectedCount }));
        return;
      }
      showError(error, tb("delete-error"));
    }
  };

  const tooMany = selectedCount > BULK_TRANSACTION_LIMIT;
  const busy = isSubmitting || isDeleting;

  return (
    <Slide isOpen={opened} classname="z-10">
      <div className="bg-card mx-auto mb-8 flex w-fit max-w-full flex-col gap-3 rounded-md border p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
          <Text className="min-w-[120px] text-center">
            {allMatching ? (
              tb("all-matching-selected", { count: selectedCount })
            ) : (
              <>
                <strong>{selectedCount}</strong> {t("selected").toLowerCase()}
              </>
            )}
          </Text>
          <div className="flex flex-wrap gap-3 md:gap-4">
            <CategorySelect
              key={categoryPickerKey}
              triggerProps={{
                variant: "outline",
                size: "default",
                loading: isLoadingConfigs,
                className: "text-foreground",
                disabled: busy || tooMany,
              }}
              categories={configsData?.categories ?? []}
              onChange={onPickCategory}
            />
            <TransactionBulkTagMenu
              carriedTagKeys={carriedTagKeys}
              disabled={busy || tooMany}
              onAdd={onAddTag}
              onRemove={onRemoveTag}
            />
            {!allTransactionsReviewed && (
              <Button
                onClick={() =>
                  void run(
                    "account_transactions_review_set_reviewed",
                    { reviewed: true },
                    t("transaction-reviewed"),
                  )
                }
                variant="outline"
                loading={isSubmitting}
                disabled={busy || tooMany}
                className="text-foreground"
              >
                {t("reviewed")}
                <CheckCircle className="ml-2 size-4" />
              </Button>
            )}
            {allTransactionsVisible && (
              <Button
                onClick={() =>
                  void run(
                    "account_transactions_review_set_hidden",
                    { hidden: true },
                    t("transaction-hidden-toast"),
                  )
                }
                variant="outline"
                loading={isSubmitting}
                disabled={busy || tooMany}
                className="text-foreground"
              >
                {t("hide")}
              </Button>
            )}
            {allTransactionsHidden && (
              <Button
                onClick={() =>
                  void run(
                    "account_transactions_review_set_hidden",
                    { hidden: false },
                    t("transaction-unhidden-toast"),
                  )
                }
                variant="outline"
                loading={isSubmitting}
                disabled={busy || tooMany}
                className="text-foreground"
              >
                {t("unhide")}
              </Button>
            )}
            <Button
              onClick={() => setDeleteOpen(true)}
              variant="outline"
              disabled={busy || tooMany || selectedCount === 0}
              className="text-destructive-text"
            >
              <Trash2 className="mr-2 size-4" />
              {tb("delete")}
            </Button>
          </div>
        </div>
        {selectAllMatching && !allMatching ? (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <Text variant="mutedText">
              {tb("page-selected", { count: persisted.length })}
            </Text>
            {selectAllMatching.total > BULK_TRANSACTION_LIMIT ? (
              <Text variant="mutedText">
                {tb("too-many-matching", { max: BULK_TRANSACTION_LIMIT })}
              </Text>
            ) : (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={selectAllMatching.onSelect}
              >
                {tb("select-all-matching", { count: selectAllMatching.total })}
              </Button>
            )}
          </div>
        ) : null}
        {allMatching ? (
          <div className="flex justify-center">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={onResetSelection}
            >
              {tb("clear-selection")}
            </Button>
          </div>
        ) : null}
      </div>
      <TransactionBulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={selectedCount}
        syncedCount={allMatching ? null : syncedIds.length}
        pending={isDeleting}
        onConfirm={() => void onDelete()}
        onHideSynced={
          allMatching
            ? undefined
            : () => {
                setDeleteOpen(false);
                void hideIds(syncedIds);
              }
        }
      />
      {replaceSplitDialog}
    </Slide>
  );
};

export default TransactionReviewControl;
