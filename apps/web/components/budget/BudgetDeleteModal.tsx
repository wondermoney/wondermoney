"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { Budget } from "@/lib/api/budget/useBudgets";
import useDeleteBudget from "@/lib/api/budget/useDeleteBudget";
import { invalidateBudgets } from "@/lib/utils/queryInvalidation";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface BudgetDeleteModalProps {
  isOpen: boolean;
  closeModal: () => void;
  budgetName: Budget["name"];
  budgetKey: Budget["budgetKey"];
}

const BudgetDeleteModal: React.FC<BudgetDeleteModalProps> = ({
  isOpen,
  closeModal,
  budgetName,
  budgetKey,
}) => {
  const t = useTranslations();
  const deleteBudgetMutation = useDeleteBudget();
  const qc = useQueryClient();
  const router = useRouter();
  const posthog = usePostHog();

  const onDeleteBudget = () => {
    deleteBudgetMutation.mutate(
      { budgetKey },
      {
        onSuccess: async () => {
          posthog.capture("budget_deleted", { budget_key: budgetKey });
          await invalidateBudgets(qc, { refresh: () => router.refresh() });
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
            {t.rich("delete-budget-confirmation", {
              budgetName,
              strong: (chunks) => (
                <span className="bg-muted p-1 font-bold whitespace-nowrap">
                  {chunks}
                </span>
              ),
            })}
          </AlertDialogTitle>
          {/* Was `<Text variant="p">` nested inside AlertDialogDescription,
              which is itself a <p> — invalid HTML that React logged on every
              open ("<p> cannot contain a nested <p>"). The description already
              carries the muted/sm type, so the wrapper was only doing harm.
              The copy was `delete-account-description` — "You'll lose all data
              related to this account, including transactions" — which is not
              what deleting a budget does, in a dialog whose whole job is to
              tell you what you are about to lose. */}
          <AlertDialogDescription>
            {t("delete-budget-description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBudget();
            }}
          >
            {t("delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BudgetDeleteModal;
