"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React from "react";

import { Text } from "@/components/ui/Typography";
import useDeleteAccount from "@/lib/api/account/useDeleteAccount";
import { Transaction } from "@/lib/api/account/useTransactions";

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

const AccountTransactionDeleteModal: React.FC<
  AccountTransactionDeleteModalProps
> = ({ isOpen, closeModal, transaction }) => {
  const t = useTranslations();
  const deleteAccountMutation = useDeleteAccount();
  const qc = useQueryClient();
  const posthog = usePostHog();

  const onDeleteTransaction = async () => {
    posthog.capture("account_transaction_delete", {
      transactionKey: transaction.transactionKey,
    });
    /*  await deleteAccountMutation.mutateAsync(
      { accountKey: transaction.accountKey },
      {
        onSuccess: () => {
          // accounts, accounts-metrics, accounts-transactions TODO: we should be able to just
          // invalidate "accounts" since it invalidates the other two (start with), but for some
          // reason its not working
          qc.invalidateQueries({ queryKey: ["accounts"] });
          qc.invalidateQueries({ queryKey: ["accounts-transactions"] });
          qc.invalidateQueries({ queryKey: ["accounts-metrics"] });
          closeModal();
        },
      },
    ); */
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeModal}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("delete-transaction-confirmation")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Text variant="p">{t("delete-transaction-description")}</Text>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTransaction();
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default AccountTransactionDeleteModal;
