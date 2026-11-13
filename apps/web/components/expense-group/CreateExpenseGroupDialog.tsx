"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { useRouter } from "@/i18n/navigation";
import useCurrencies from "@/lib/api/account/useCurrencies";
import type { ExpenseGroupMemberInput } from "@/lib/api/expense-group/types";
import { useCreateExpenseGroup } from "@/lib/api/expense-group/useExpenseGroups";
import useHousehold from "@/lib/api/household/useHousehold";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";

import { selectClassName, useGroupErrorMessage } from "./shared";

interface OutsiderRow {
  id: number;
  name: string;
  email: string;
}

let nextRowId = 0;
const newRow = (): OutsiderRow => ({ id: ++nextRowId, name: "", email: "" });

/** A household member's name as the household screen shows it. */
export const householdMemberName = (member: {
  firstName?: string | null;
  emailAddress: string;
}) => member.firstName?.trim() || member.emailAddress;

/**
 * "New group": a name, the currency new settlements default to, and the people. The creator is
 * added by the API; others are household members, picked, or people outside the household, by
 * name with an optional email kept only for reference.
 */
export function CreateExpenseGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("expenseGroups.create");
  const tGroups = useTranslations("expenseGroups");
  const tRoot = useTranslations();
  const router = useRouter();
  const posthog = usePostHog();
  const errorMessage = useGroupErrorMessage();
  const create = useCreateExpenseGroup();
  const currencies = useCurrencies({ enabled: open });
  const netWorth = useNetWorth({ enabled: open });
  const household = useHousehold({ enabled: open });

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string | null>(null);
  const [householdKeys, setHouseholdKeys] = useState<number[]>([]);
  const [outsiders, setOutsiders] = useState<OutsiderRow[]>(() => [newRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const chosenCurrency =
    currency ?? netWorth.data?.netWorth.currencyCode ?? "EUR";
  const currencyCodes = Array.from(
    new Set([
      chosenCurrency,
      ...(currencies.data?.currencies ?? []).map((c) => c.code),
    ]),
  );
  const others = (household.data?.members ?? []).filter(
    (member) => member.appuserKey !== household.data?.viewerAppuserKey,
  );
  const nameMissing = name.trim() === "";
  // A row with an email but no name cannot be sent; an empty row is ignored.
  const rowMissingName = (row: OutsiderRow) =>
    row.name.trim() === "" && row.email.trim() !== "";

  const reset = () => {
    setName("");
    setCurrency(null);
    setHouseholdKeys([]);
    setOutsiders([newRow()]);
    setSubmitted(false);
    setRefusal(null);
  };

  const submit = async () => {
    setSubmitted(true);
    if (nameMissing || outsiders.some(rowMissingName)) return;
    setRefusal(null);
    const members: ExpenseGroupMemberInput[] = [
      ...others
        .filter((member) => householdKeys.includes(member.appuserKey))
        .map((member) => ({
          name: householdMemberName(member),
          householdMemberId: member.appuserKey,
        })),
      ...outsiders
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({
          name: row.name.trim(),
          email: row.email.trim() || null,
        })),
    ];
    try {
      const group = await create.mutateAsync({
        name: name.trim(),
        currencyCode: chosenCurrency,
        members,
      });
      posthog.capture("expense_group_created", { people: members.length + 1 });
      toast.success(t("created"));
      onOpenChange(false);
      reset();
      router.push(`/groups/${group.expenseGroupKey}`);
    } catch (error) {
      setRefusal(errorMessage(error));
    }
  };

  const busy = create.isPending;

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title={t("title")}
      description={t("description")}
    >
      <form
        className="space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div className="space-y-1">
            <Label htmlFor="expense-group-name">{t("name")}</Label>
            <Input
              id="expense-group-name"
              placeholder={t("name-placeholder")}
              maxLength={100}
              disabled={busy}
              value={name}
              aria-invalid={submitted && nameMissing ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {submitted && nameMissing ? (
              <p className="text-destructive-text text-xs">
                {t("name-required")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="expense-group-currency">{t("currency")}</Label>
            <select
              id="expense-group-currency"
              className={selectClassName}
              disabled={busy}
              value={chosenCurrency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-muted-foreground -mt-4 text-xs">
          {t("currency-hint")}
        </p>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("people")}</legend>
          <p className="text-muted-foreground text-xs">{t("people-hint")}</p>

          {others.length > 0 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">{t("household")}</p>
              <ul className="space-y-2">
                {others.map((member) => {
                  const id = `expense-group-household-${member.appuserKey}`;
                  return (
                    <li
                      key={member.appuserKey}
                      className="flex items-center gap-3"
                    >
                      <Checkbox
                        id={id}
                        disabled={busy}
                        checked={householdKeys.includes(member.appuserKey)}
                        onCheckedChange={(checked) =>
                          setHouseholdKeys((current) =>
                            checked === true
                              ? [...current, member.appuserKey]
                              : current.filter(
                                  (key) => key !== member.appuserKey,
                                ),
                          )
                        }
                      />
                      <Label htmlFor={id} className="font-normal">
                        {householdMemberName(member)}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">{t("outside")}</p>
            <ul className="space-y-3">
              {outsiders.map((row, index) => {
                const missing = submitted && rowMissingName(row);
                const label = row.name.trim() || `${index + 1}`;
                return (
                  <li key={row.id} className="space-y-1">
                    <div className="flex items-start gap-2">
                      <Input
                        aria-label={t("person-name")}
                        placeholder={t("person-name")}
                        maxLength={100}
                        disabled={busy}
                        value={row.name}
                        aria-invalid={missing ? true : undefined}
                        onChange={(event) =>
                          setOutsiders((current) =>
                            current.map((r) =>
                              r.id === row.id
                                ? { ...r, name: event.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <Input
                        type="email"
                        aria-label={t("person-email")}
                        placeholder={t("person-email")}
                        maxLength={254}
                        disabled={busy}
                        value={row.email}
                        onChange={(event) =>
                          setOutsiders((current) =>
                            current.map((r) =>
                              r.id === row.id
                                ? { ...r, email: event.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("remove-person", { name: label })}
                        disabled={busy}
                        onClick={() =>
                          setOutsiders((current) =>
                            current.filter((r) => r.id !== row.id),
                          )
                        }
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {missing ? (
                      <p className="text-destructive-text text-xs">
                        {t("person-name-required")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-muted-foreground text-xs">{t("email-hint")}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setOutsiders((current) => [...current, newRow()])}
            >
              <Plus className="size-4" aria-hidden />
              {tGroups("add-person")}
            </Button>
          </div>
        </fieldset>

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
            onClick={() => onOpenChange(false)}
          >
            {tRoot("cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </DrawerDialog>
  );
}
