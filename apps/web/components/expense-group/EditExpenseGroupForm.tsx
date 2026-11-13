"use client";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import useCurrencies from "@/lib/api/account/useCurrencies";
import type { ExpenseGroup } from "@/lib/api/expense-group/types";
import { useUpdateExpenseGroup } from "@/lib/api/expense-group/useExpenseGroups";
import { groupEditChanges } from "@/lib/expense-group/expense-group";

import { selectClassName, useGroupErrorMessage } from "./shared";

/**
 * "Edit group": its name and the currency new settlements default to. Only what changed is
 * sent; the group refetches after the save, as after every group write. A refusal stays in the
 * form, in the API's words where this client knows them, with the draft kept.
 */
export function EditExpenseGroupForm({
  group,
  onDone,
  onCancel,
}: {
  group: ExpenseGroup;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const posthog = usePostHog();
  const errorMessage = useGroupErrorMessage();
  const update = useUpdateExpenseGroup(group.expenseGroupKey);
  const currencies = useCurrencies();

  const [name, setName] = useState(group.name);
  const [currency, setCurrency] = useState(group.currencyCode);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const nameMissing = name.trim() === "";
  const currencyCodes = Array.from(
    new Set([
      group.currencyCode,
      ...(currencies.data?.currencies ?? []).map((c) => c.code),
    ]),
  );
  const busy = update.isPending;

  const submit = async () => {
    setSubmitted(true);
    if (nameMissing) return;
    const changes = groupEditChanges(group, { name, currencyCode: currency });
    if (!changes) {
      onDone();
      return;
    }
    setRefusal(null);
    try {
      await update.mutateAsync(changes);
    } catch (error) {
      setRefusal(errorMessage(error));
      return;
    }
    posthog.capture("expense_group_updated", {
      renamed: changes.name !== undefined,
      currency_changed: changes.currencyCode !== undefined,
    });
    toast.success(t("edit.saved"));
    onDone();
  };

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="expense-group-edit-name">{t("create.name")}</Label>
          <Input
            id="expense-group-edit-name"
            maxLength={100}
            disabled={busy}
            value={name}
            aria-invalid={submitted && nameMissing ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {submitted && nameMissing ? (
            <p className="text-destructive-text text-xs">
              {t("create.name-required")}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="expense-group-edit-currency">
            {t("create.currency")}
          </Label>
          <select
            id="expense-group-edit-currency"
            className={selectClassName}
            disabled={busy}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {currencyCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {t("edit.currency-hint")}
          </p>
        </div>
      </div>

      {refusal ? (
        <p role="alert" className="text-destructive-text text-sm">
          {refusal}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          {tRoot("cancel")}
        </Button>
        <Button type="submit" loading={busy} disabled={busy}>
          {t("detail.save")}
        </Button>
      </div>
    </form>
  );
}
