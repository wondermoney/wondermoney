"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import useDeleteUserAccount from "@/lib/api/user/useDeleteUserAccount";
import { authClient } from "@/lib/auth/client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface UserAccountDeleteProps {
  isOpen: boolean;
  closeModal: () => void;
}

export default function UserAccountDelete({
  isOpen,
  closeModal,
}: UserAccountDeleteProps) {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const deleteUserAccountMutation = useDeleteUserAccount();
  const [hasDeletionError, setHasDeletionError] = useState(false);
  const [isProcessingDeletion, setIsProcessingDeletion] = useState(false);
  const isDeleting =
    isProcessingDeletion || deleteUserAccountMutation.isPending;

  useEffect(() => {
    if (isOpen) {
      setHasDeletionError(false);
    }
  }, [isOpen]);

  const onDeleteClickHandler = async () => {
    setIsProcessingDeletion(true);
    setHasDeletionError(false);
    let didNavigateAway = false;

    try {
      await deleteUserAccountMutation.mutateAsync();

      await queryClient.cancelQueries();
      queryClient.clear();

      // Best-effort: the account is already deleted server-side at this
      // point, so a sign-out failure here is just a client-side cookie
      // cleanup hiccup, not a reason to block navigation or report a
      // deletion error.
      await authClient.signOut().catch((signOutError) => {
        console.error(
          "Error signing out after deleting WonderMoney account",
          signOutError,
        );
      });

      posthog.reset();
      didNavigateAway = true;
      router.push("/auth/login");
    } catch (error) {
      console.error("Error deleting WonderMoney account", error);
      setHasDeletionError(true);
    } finally {
      if (!didNavigateAway) {
        setIsProcessingDeletion(false);
      }
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          closeModal();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("delete-wondermoney-account-confirm")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block">
              {t("delete-wondermoney-account-description")}
            </span>
            {hasDeletionError && (
              <span className="text-destructive-text mt-3 block">
                {t("delete-wondermoney-account-error")}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            loading={isDeleting}
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClickHandler();
            }}
          >
            {isDeleting
              ? t("deleting-account")
              : t("delete-wondermoney-account-confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
