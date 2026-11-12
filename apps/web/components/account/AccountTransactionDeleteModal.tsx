"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React from "react";
import { toast } from "sonner";

import { Text } from "@/components/ui/Typography";
import {
  invalidateAfterTransactionDelete,
  useDeleteTransaction,
} from "@/lib/api/account/useDeleteTransactions";
import useEditTransactions from "@/lib/api/account/useEditTransactions";
import { Transaction } from "@/lib/api/account/useTransactions";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

interface AccountTransactionDeleteModalProps {
  isOpen: boolean;
  closeModal: () => void;
  transaction: Transaction;
}

/**
 * Deletes one transaction after a confirmation. A row the bank sent cannot be
 * deleted (the next sync would send it again): the dialog says so and offers to
 * hide it instead, which takes it out of every list and total.
 */
const AccountTransactionDeleteModal: React.FC<
  AccountTransactionDeleteModalProps
> = ({ isOpen, closeModal, transaction }) => {
  const t = useTranslations();
  const tb = useTranslations("transactionBulk");
  const qc = useQueryClient();
  const posthog = usePostHog();
  const deleteTransaction = useDeleteTransaction();
  const editTransactions = useEditTransactions();
  const bankSynced = transaction.bankSynced === true;
  const pending = deleteTransaction.isPending || editTransactions.isPending;

  const showError = (error: unknown, fallback: string) => {
    if (isDemoReadOnlyError(error)) {
      toast.error(t("demo-read-only-title"), {
        description: t("demo-read-only-description"),
      });
      return;
    }
    toast.error(fallback, { duration: 9000 });
  };

  const onDelete = async () => {
    posthog.capture("account_transaction_delete", {
      transactionKey: transaction.transactionKey,
    });
    try {
      await deleteTransaction.mutateAsync(transaction.transactionKey);
      await invalidateAfterTransactionDelete(qc);
      toast.success(tb("deleted-toast", { count: 1 }));
      closeModal();
    } catch (error) {
      if (getApiErrorCode(error) === API_ERROR_CODE.TRANSACTION_BANK_SYNCED) {
        toast.error(tb("delete-only-synced", { count: 1 }));
        return;
      }
      showError(error, tb("delete-error"));
    }
  };

  const onHide = async () => {
    try {
      await editTransactions.mutateAsync({
        transactionIds: [transaction.transactionKey],
        hidden: true,
      });
      await invalidateAfterTransactionDelete(qc);
      toast.success(t("transaction-hidden-toast"));
      closeModal();
    } catch (error) {
      showError(error, t("toast-edit-transaction-error"));
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeModal}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {bankSynced
              ? tb("delete-only-synced-title", { count: 1 })
              : t("delete-transaction-confirmation")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <Text variant="p">
                {bankSynced
                  ? tb("delete-only-synced", { count: 1 })
                  : tb("delete-description")}
              </Text>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("cancel")}
          </AlertDialogCancel>
          {bankSynced ? (
            transaction.hidden ? null : (
              <Button
                variant="outline"
                loading={editTransactions.isPending}
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  void onHide();
                }}
              >
                {tb("hide-synced", { count: 1 })}
              </Button>
            )
          ) : (
            <Button
              variant="destructive"
              loading={deleteTransaction.isPending}
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation();
                void onDelete();
              }}
            >
              {tb("delete-confirm", { count: 1 })}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default AccountTransactionDeleteModal;
