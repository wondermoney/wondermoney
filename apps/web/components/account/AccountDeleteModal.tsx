"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React from "react";

import useDeleteAccount from "@/lib/api/account/useDeleteAccount";

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

interface AccountDeleteModalProps {
  isOpen: boolean;
  closeModal: () => void;
  accountName: string;
  accountKey: string;
}

const AccountDeleteModal: React.FC<AccountDeleteModalProps> = ({
  isOpen,
  closeModal,
  accountName,
  accountKey,
}) => {
  const t = useTranslations();
  const deleteAccountMutation = useDeleteAccount();
  const qc = useQueryClient();
  const posthog = usePostHog();

  const onDeleteAccount = () => {
    posthog.capture("account_delete", { accountKey });
    deleteAccountMutation.mutate(
      { accountKey },
      {
        onSuccess: () => {
          // accounts, accounts-metrics, accounts-transactions TODO: we should be able to just
          // invalidate "accounts" since it invalidates the other two (start with), but for some
          // reason its not working
          qc.invalidateQueries({
            queryKey: ["accounts"],
          });
          qc.invalidateQueries({
            queryKey: ["accounts-transactions"],
          });
          qc.invalidateQueries({
            queryKey: ["accounts-metrics"],
          });
          closeModal();
        },
      },
    );
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeModal}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t.rich("delete-account-confirmation", {
              accountName,
              strong: (chunks) => (
                <span className="bg-muted p-1 font-bold whitespace-nowrap">
                  {chunks}
                </span>
              ),
            })}
          </AlertDialogTitle>
          {/* AlertDialogDescription is already a <p>; the inner Text made it
              a nested <p>, which React rejects. Same defect as the budget
              delete modal. */}
          <AlertDialogDescription>
            {t("delete-account-description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            loading={deleteAccountMutation.isPending}
            disabled={deleteAccountMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteAccount();
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default AccountDeleteModal;
