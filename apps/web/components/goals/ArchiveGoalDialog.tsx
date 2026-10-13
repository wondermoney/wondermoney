"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

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
import { buttonVariants } from "@/components/ui/button";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import useDeleteGoal from "@/lib/api/goals/useDeleteGoal";
import { formatGoalCurrency } from "@/lib/goals/format";

type ArchiveGoalDialogProps = {
  readonly availableAmount: number;
  readonly currencyCode?: string;
  readonly goalKey: number;
  readonly isOpen: boolean;
  readonly onMoveMoneyOut: () => void;
  readonly onOpenChange: (open: boolean) => void;
};

export default function ArchiveGoalDialog({
  availableAmount,
  currencyCode,
  goalKey,
  isOpen,
  onMoveMoneyOut,
  onOpenChange,
}: ArchiveGoalDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const mutation = useDeleteGoal(goalKey);
  const hasBalance = availableAmount > 0;

  const archive = async () => {
    try {
      await mutation.mutateAsync();
      toast.success(t("goals.archive-success"));
      router.push("/goals");
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("goals.archive-error"));
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("goals.archive-confirm-title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasBalance
              ? t("goals.confirm-archive-with-balance", {
                  amount: formatGoalCurrency(
                    availableAmount,
                    currencyCode,
                    locale,
                  ),
                })
              : t("goals.archive-confirm-description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          {hasBalance ? (
            <AlertDialogAction onClick={onMoveMoneyOut}>
              {t("goals.move-money-out")}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={mutation.isPending}
              onClick={archive}
            >
              {t("goals.archive")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
