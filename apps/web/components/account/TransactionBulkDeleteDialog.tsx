"use client";

import { useTranslations } from "next-intl";

import { Text } from "@/components/ui/Typography";

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

interface TransactionBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many rows are selected. */
  count: number;
  /**
   * How many of them the bank sent, which are skipped. `null` when the
   * selection is every matching row: the client does not know, and says that
   * any bank rows among them are skipped.
   */
  syncedCount: number | null;
  pending: boolean;
  onConfirm: () => void;
  /** Hide the bank-synced rows instead. Offered when they are known. */
  onHideSynced?: () => void;
}

/**
 * Confirms a bulk delete with the count, and says why rows the bank sent are
 * skipped (the next sync would send them again) and that hiding is the way to
 * take them out of lists and totals.
 */
export function TransactionBulkDeleteDialog({
  open,
  onOpenChange,
  count,
  syncedCount,
  pending,
  onConfirm,
  onHideSynced,
}: TransactionBulkDeleteDialogProps) {
  const t = useTranslations("transactionBulk");
  const deletable = syncedCount === null ? count : count - syncedCount;
  const onlySynced = syncedCount !== null && syncedCount > 0 && deletable === 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {onlySynced
              ? t("delete-only-synced-title", { count })
              : t("delete-title", { count: deletable })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {onlySynced ? (
                <Text variant="p">{t("delete-only-synced", { count })}</Text>
              ) : (
                <Text variant="p">{t("delete-description")}</Text>
              )}
              {!onlySynced && syncedCount !== null && syncedCount > 0 ? (
                <Text variant="p">
                  {t("delete-synced-note", { count: syncedCount })}
                </Text>
              ) : null}
              {syncedCount === null ? (
                <Text variant="p">{t("delete-matching-synced-note")}</Text>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("cancel")}
          </AlertDialogCancel>
          {onHideSynced && syncedCount !== null && syncedCount > 0 ? (
            <Button variant="outline" disabled={pending} onClick={onHideSynced}>
              {t("hide-synced", { count: syncedCount })}
            </Button>
          ) : null}
          {onlySynced ? null : (
            <Button
              variant="destructive"
              loading={pending}
              disabled={pending}
              onClick={onConfirm}
            >
              {t("delete-confirm", { count: deletable })}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
