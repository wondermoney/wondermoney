"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
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
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  invalidateTransactionTemplates,
  useCreateTransactionTemplate,
} from "@/lib/api/transaction-template/useTransactionTemplates";
import { parseAmountInput } from "@/lib/utils/number";

/**
 * "New template" from the add form: a template with no transaction behind it. It saves only
 * the shape of the entry; using it later fills the form and never creates anything.
 */
export function TransactionTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const createTemplate = useCreateTransactionTemplate();

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDirection("out");
    setAmount("");
    setDescription("");
    setNotes("");
    setError(null);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("transactionTemplates.name-required"));
      return;
    }
    const parsedAmount =
      amount.trim() === "" ? null : parseAmountInput(amount, locale);
    if (amount.trim() !== "" && (parsedAmount === null || parsedAmount <= 0)) {
      setError(t("transactionTemplates.amount-invalid"));
      return;
    }
    setError(null);
    try {
      await createTemplate.mutateAsync({
        amount: parsedAmount,
        description: description.trim() || null,
        direction,
        name: trimmedName,
        notes: notes.trim() || null,
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
          <DialogTitle>{t("transactionTemplates.new-template")}</DialogTitle>
          <DialogDescription>
            {t("transactionTemplates.new-template-description")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" id="new-transaction-template-form" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="template-name">
              {t("transactionTemplates.name")}
            </Label>
            <Input
              id="template-name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("transactionTemplates.name-placeholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-direction">
              {t("transactionTemplates.direction")}
            </Label>
            <select
              id="template-direction"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value === "in" ? "in" : "out")
              }
            >
              <option value="out">{t("transactionTemplates.direction-out")}</option>
              <option value="in">{t("transactionTemplates.direction-in")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-amount">
              {t("transactionTemplates.amount")}
            </Label>
            <Input
              id="template-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={t("transactionTemplates.amount-placeholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-description">
              {t("transactionTemplates.description")}
            </Label>
            <Input
              id="template-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-notes">
              {t("transactionTemplates.notes")}
            </Label>
            <Textarea
              id="template-notes"
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
            form="new-transaction-template-form"
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
