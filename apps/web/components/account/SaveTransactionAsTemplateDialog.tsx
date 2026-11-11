"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  invalidateTransactionTemplates,
  useCreateTransactionTemplate,
} from "@/lib/api/transaction-template/useTransactionTemplates";

const defaultName = (transaction: Transaction) =>
  (
    transaction.transactionMerchantKey?.name ??
    transaction.description ??
    ""
  ).trim();

/**
 * "Save as template" from the transaction edit sheet: the API copies the row's account,
 * amount, direction, description, merchant, category and notes, and only the name is asked
 * for here.
 */
export function SaveTransactionAsTemplateDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const createTemplate = useCreateTransactionTemplate();
  const [name, setName] = useState(() => defaultName(transaction));
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setName(defaultName(transaction));
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("transactionTemplates.name-required"));
      return;
    }
    setError(null);
    try {
      await createTemplate.mutateAsync({
        fromTransactionId: transaction.transactionKey,
        name: trimmedName,
      });
      await invalidateTransactionTemplates(queryClient);
      toast.success(t("transactionTemplates.created"), { duration: 9000 });
      close(false);
    } catch (caught) {
      toast.error(
        isDemoReadOnlyError(caught)
          ? t("demo-read-only-title")
          : (getApiErrorMessage(caught) ?? t("transactionTemplates.save-failed")),
        { duration: 9000 },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("transactionTemplates.save-as-template")}</DialogTitle>
          <DialogDescription>
            {t("transactionTemplates.save-as-template-description")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" id="save-transaction-template-form" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="save-template-name">
              {t("transactionTemplates.name")}
            </Label>
            <Input
              id="save-template-name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-destructive-text text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="save-transaction-template-form"
            loading={createTemplate.isPending}
            disabled={createTemplate.isPending}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
