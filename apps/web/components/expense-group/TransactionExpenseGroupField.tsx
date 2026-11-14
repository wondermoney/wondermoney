"use client";

import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import CategorySelect from "@/components/CategorySelect";
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
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Link } from "@/components/ui/Link";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { unitsToNumber } from "@/lib/account/transaction-split";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Category } from "@/lib/api/category/useCategories";
import type {
  ExpenseGroup,
  ExpenseGroupSplitMethod,
  GroupExpense,
} from "@/lib/api/expense-group/types";
import {
  useExpenseGroupExpense,
  useExpenseGroups,
  useShareExpense,
  useUnshareExpense,
} from "@/lib/api/expense-group/useExpenseGroups";
import {
  defaultPayerKey,
  groupShareBlocker,
  memberName,
  prefillShares,
  previewShares,
  sharedGroupOf,
  type SharePreview,
  shareTotalUnits,
  toShareRequest,
} from "@/lib/expense-group/expense-group";
import { useIsHouseholdViewer } from "@/lib/household/useIsHouseholdViewer";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import {
  keepEnterInside,
  selectClassName,
  useGroupErrorMessage,
  useGroupErrorToast,
} from "./shared";

const METHODS: ExpenseGroupSplitMethod[] = ["equal", "amounts", "percentages"];

/** Where the editor starts: a new share, or the transaction's current shares. */
interface EditorStart {
  groupKey: number | null;
  payerKey: number | null;
  method: ExpenseGroupSplitMethod;
  included: number[];
  values: Record<number, string>;
}

function startFor(group: ExpenseGroup | undefined): EditorStart {
  return {
    groupKey: group?.expenseGroupKey ?? null,
    payerKey: group ? defaultPayerKey(group.members) : null,
    method: "equal",
    included:
      group?.members.map((member) => member.expenseGroupMemberKey) ?? [],
    values: {},
  };
}

function startFromExpense(expense: GroupExpense, locale: string): EditorStart {
  const { method, values } = prefillShares(expense, locale);
  return {
    groupKey: expense.expenseGroupKey,
    payerKey: expense.paidByMemberKey,
    method,
    included: expense.shares.map((share) => share.expenseGroupMemberKey),
    values,
  };
}

/** What the editor says under the people: what is left, or why it cannot be saved yet. */
function useShareStatus() {
  const t = useTranslations("expenseGroups.share");
  const locale = useLocale();
  return (
    preview: SharePreview,
    method: ExpenseGroupSplitMethod,
    currency: string,
    formatAmount: (value: number, currency: string) => string,
  ): { text: string; problem: boolean } => {
    const percent = (value: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    switch (preview.problem) {
      case null:
        return { text: t("all-assigned"), problem: false };
      case "no-people":
        return { text: t("no-people"), problem: true };
      case "zero-share":
        return { text: t("zero-share"), problem: true };
      case "line-errors":
        return {
          text:
            method === "percentages"
              ? t("line-errors-percentages")
              : t("line-errors-amounts"),
          problem: true,
        };
      case "unassigned":
        return {
          text:
            method === "percentages"
              ? t("left-percent", {
                  percent: percent(preview.remainingPercent),
                })
              : t("left-amount", {
                  amount: formatAmount(
                    unitsToNumber(preview.remainingUnits),
                    currency,
                  ),
                }),
          problem: true,
        };
      case "over-assigned":
        return {
          text:
            method === "percentages"
              ? t("over-percent", {
                  percent: percent(-preview.remainingPercent),
                })
              : t("over-amount", {
                  amount: formatAmount(
                    unitsToNumber(-preview.remainingUnits),
                    currency,
                  ),
                }),
          problem: true,
        };
    }
  };
}

interface EditorProps {
  transaction: Transaction;
  /** The groups it can be shared in (not archived), or the one it is shared in. */
  groups: ExpenseGroup[];
  start: EditorStart;
  /** Editing the shares of a transaction already shared: the group is fixed. */
  editing: boolean;
  categories: Category[];
  disabled: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * Choosing how a transaction is shared: the group, who paid (someone of the household), the
 * method, the people and their amounts or percentages, with a live "left to assign" that follows
 * the API's rules, and the category every share goes in.
 */
function GroupShareEditor({
  transaction,
  groups,
  start,
  editing,
  categories,
  disabled,
  onCancel,
  onSaved,
}: EditorProps) {
  const t = useTranslations("expenseGroups.share");
  const locale = useLocale();
  const posthog = usePostHog();
  const errorMessage = useGroupErrorMessage();
  const shareStatus = useShareStatus();
  const formatAmount = useFormatCurrency();

  const [groupKey, setGroupKey] = useState(start.groupKey);
  const [payerKey, setPayerKey] = useState(start.payerKey);
  const [method, setMethod] = useState(start.method);
  const [included, setIncluded] = useState<number[]>(start.included);
  const [values, setValues] = useState<Record<number, string>>(start.values);
  const initialCategory = transaction.appuserTransactionCategories[0];
  const [categoryKey, setCategoryKey] = useState<string | undefined>(
    initialCategory ? String(initialCategory.categoryKey) : undefined,
  );
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const group = groups.find((g) => g.expenseGroupKey === groupKey);
  const share = useShareExpense(groupKey ?? 0);
  const currency = transaction.settlementCurrencyKey.code;
  const totalUnits = shareTotalUnits(transaction);
  const members = group?.members ?? [];
  const payers = members.filter((member) => member.isHouseholdMember);
  const people = members
    .filter((member) => included.includes(member.expenseGroupMemberKey))
    .map((member) => ({
      memberKey: member.expenseGroupMemberKey,
      value: values[member.expenseGroupMemberKey] ?? "",
    }));
  const preview = previewShares(totalUnits, method, people, locale);
  const status = shareStatus(preview, method, currency, formatAmount);
  const busy = disabled || share.isPending;
  const wasSplit = !editing && (transaction.splits?.length ?? 0) > 0;

  const chooseGroup = (key: number) => {
    const next = groups.find((g) => g.expenseGroupKey === key);
    const fresh = startFor(next);
    setGroupKey(fresh.groupKey);
    setPayerKey(fresh.payerKey);
    setIncluded(fresh.included);
    setValues({});
    setSubmitted(false);
    setRefusal(null);
  };

  const toggle = (memberKey: number, on: boolean) =>
    setIncluded((current) =>
      on
        ? members
            .map((member) => member.expenseGroupMemberKey)
            .filter((key) => key === memberKey || current.includes(key))
        : current.filter((key) => key !== memberKey),
    );

  const submit = async () => {
    setSubmitted(true);
    if (!group || payerKey === null || preview.problem !== null) return;
    setRefusal(null);
    const initialKey = initialCategory
      ? String(initialCategory.categoryKey)
      : undefined;
    try {
      await share.mutateAsync({
        transactionId: transaction.transactionKey,
        paidByMemberId: payerKey,
        method,
        // Left out keeps the transaction's category.
        ...(categoryKey !== initialKey && categoryKey !== undefined
          ? { categoryId: Number(categoryKey) }
          : {}),
        shares: toShareRequest(method, people, preview),
      });
    } catch (error) {
      setRefusal(errorMessage(error));
      return;
    }
    posthog.capture("expense_group_expense_shared", {
      method,
      people: people.length,
      edited: editing,
    });
    toast.success(editing ? t("updated") : t("shared", { group: group.name }));
    onSaved();
  };

  const statusId = `group-share-status-${transaction.transactionKey}`;

  return (
    <div className="bg-muted space-y-4 rounded-md p-3">
      {editing ? null : (
        <div className="space-y-1">
          <Label htmlFor={`group-share-group-${transaction.transactionKey}`}>
            {t("group")}
          </Label>
          <select
            id={`group-share-group-${transaction.transactionKey}`}
            className={selectClassName}
            disabled={busy}
            value={groupKey ?? ""}
            onChange={(event) => chooseGroup(Number(event.target.value))}
          >
            {groups.map((g) => (
              <option key={g.expenseGroupKey} value={g.expenseGroupKey}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`group-share-payer-${transaction.transactionKey}`}>
          {t("paid-by")}
        </Label>
        <select
          id={`group-share-payer-${transaction.transactionKey}`}
          className={selectClassName}
          disabled={busy}
          value={payerKey ?? ""}
          onChange={(event) => setPayerKey(Number(event.target.value))}
        >
          {payers.map((member) => (
            <option
              key={member.expenseGroupMemberKey}
              value={member.expenseGroupMemberKey}
            >
              {member.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("method")}</legend>
        <div className="border-input bg-background inline-flex flex-wrap rounded-md border p-1">
          {METHODS.map((option) => (
            <label
              key={option}
              className={cn(
                "has-[:focus-visible]:ring-ring flex min-h-9 cursor-pointer items-center rounded-sm px-3 text-sm has-[:focus-visible]:ring-2",
                method === option
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={`group-share-method-${transaction.transactionKey}`}
                value={option}
                checked={method === option}
                disabled={busy}
                onChange={() => {
                  setMethod(option);
                  setSubmitted(false);
                }}
              />
              {t(`method-${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("people")}</legend>
        <ul className="divide-border bg-background divide-y rounded-md border">
          {members.map((member) => {
            const key = member.expenseGroupMemberKey;
            const on = included.includes(key);
            const index = people.findIndex((p) => p.memberKey === key);
            const line = index >= 0 ? preview.shares[index] : undefined;
            const checkboxId = `group-share-person-${transaction.transactionKey}-${key}`;
            const lineError = submitted && on && line?.error;
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  id={checkboxId}
                  checked={on}
                  disabled={busy}
                  onCheckedChange={(checked) => toggle(key, checked === true)}
                />
                <Label
                  htmlFor={checkboxId}
                  className="min-w-0 flex-1 truncate text-sm font-normal"
                >
                  {member.name}
                </Label>
                {on && method === "amounts" ? (
                  <MoneyInput
                    aria-label={t("amount-label", { name: member.name })}
                    aria-invalid={lineError ? true : undefined}
                    className="h-9 w-28 px-3"
                    currency={currency}
                    disabled={busy}
                    value={values[key] ?? ""}
                    onEvaluated={(value) =>
                      setValues((current) => ({ ...current, [key]: value }))
                    }
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => keepEnterInside(event)}
                  />
                ) : null}
                {on && method === "percentages" ? (
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={t("percent-label", { name: member.name })}
                      aria-invalid={lineError ? true : undefined}
                      inputMode="decimal"
                      className="h-9 w-20 px-3 text-right font-mono"
                      disabled={busy}
                      value={values[key] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => keepEnterInside(event)}
                    />
                    <span className="text-muted-foreground text-sm">%</span>
                  </div>
                ) : null}
                {on && method !== "amounts" ? (
                  <Amount
                    value={
                      line?.units != null
                        ? Math.abs(unitsToNumber(line.units))
                        : null
                    }
                    currency={currency}
                    className="w-24 shrink-0 text-right font-mono text-sm"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        <p
          id={statusId}
          aria-live="polite"
          className={cn(
            "text-xs",
            status.problem && (submitted || preview.problem !== "line-errors")
              ? "text-warning-text"
              : "text-muted-foreground",
          )}
        >
          {status.text}
        </p>
      </fieldset>

      {categories.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("category")}</p>
          <CategorySelect
            categories={categories}
            initialValue={categoryKey}
            onChange={setCategoryKey}
            triggerProps={{
              "aria-label": t("category"),
              className: "text-foreground ml-0! w-full",
              disabled: busy,
              size: "sm",
              variant: "outline",
            }}
          />
          <p className="text-muted-foreground text-xs">{t("category-hint")}</p>
        </div>
      ) : null}

      {wasSplit ? (
        <p className="text-muted-foreground text-xs">{t("replaces-split")}</p>
      ) : null}

      {refusal ? (
        <p role="alert" className="text-destructive-text text-xs">
          {refusal}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          loading={share.isPending}
          disabled={busy || !group || payerKey === null}
          aria-describedby={statusId}
          onClick={() => void submit()}
        >
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={share.isPending}
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

/** A shared transaction: its group, who paid and each person's share, read-only. */
function SharedSummary({
  transaction,
  groupKey,
  group,
  readOnly,
  disabled,
  categories,
  onChanged,
}: {
  transaction: Transaction;
  groupKey: number;
  group: ExpenseGroup | undefined;
  readOnly: boolean;
  disabled: boolean;
  categories: Category[];
  onChanged: () => void;
}) {
  const t = useTranslations("expenseGroups.share");
  const tRoot = useTranslations();
  const locale = useLocale();
  const posthog = usePostHog();
  const notifyError = useGroupErrorToast();
  const expense = useExpenseGroupExpense(groupKey, transaction.transactionKey);
  const unshare = useUnshareExpense(groupKey);
  const [editing, setEditing] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const lines = (transaction.splits ?? []).filter(
    (line) => line.expenseGroupMember,
  );
  const groupName = group?.name ?? "—";
  const payer = expense.data
    ? group
      ? memberName(group.members, expense.data.paidByMemberKey)
      : null
    : null;

  const onStop = async () => {
    try {
      await unshare.mutateAsync(transaction.transactionKey);
    } catch (error) {
      notifyError(error);
      return;
    } finally {
      setConfirmingStop(false);
    }
    posthog.capture("expense_group_expense_unshared");
    toast.success(t("stopped"));
    onChanged();
  };

  if (editing && expense.data && group) {
    return (
      <GroupShareEditor
        transaction={transaction}
        groups={[group]}
        start={startFromExpense(expense.data, locale)}
        editing
        categories={categories}
        disabled={disabled}
        onCancel={() => setEditing(false)}
        onSaved={onChanged}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          {t("shared-in", { group: groupName })}
          {payer ? (
            <span className="text-muted-foreground">
              {" · "}
              {t("paid-by-name", { name: payer })}
            </span>
          ) : null}
        </span>
        <Link
          href={`/groups/${groupKey}`}
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          {t("open-group")}
        </Link>
      </div>
      <ul className="divide-border divide-y">
        {lines.map((line) => (
          <li
            key={line.transactionSplitKey}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span className="truncate">{line.expenseGroupMember!.name}</span>
            <Amount
              value={Math.abs(line.amount)}
              currency={transaction.settlementCurrencyKey.code}
              className="shrink-0 font-mono"
            />
          </li>
        ))}
      </ul>
      {expense.isError ? (
        <p className="text-destructive-text text-xs">
          {tRoot("expenseGroups.errors.load")}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !expense.data || !group}
            onClick={() => setEditing(true)}
          >
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || unshare.isPending}
            onClick={() => setConfirmingStop(true)}
          >
            {t("stop")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmingStop} onOpenChange={setConfirmingStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("stop-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("stop-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stay open while the request runs; `onStop` closes it.
                event.preventDefault();
                void onStop();
              }}
            >
              {t("stop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FieldProps {
  transaction: Transaction;
  /** For the shares' category picker. */
  categories: Category[];
  disabled?: boolean;
  /**
   * After the shares are saved or removed. The transaction's split changed, so the row the
   * sheet was opened with is stale; the sheet closes.
   */
  onChanged: () => void;
}

/**
 * The edit sheet's "Split with group": share the transaction with an expense group, or, when it
 * is shared, its group, who paid and the shares, with "Edit shares" and "Stop sharing". Saves at
 * once, apart from the sheet's Save. Viewers see the shares and nothing to change them.
 */
export function TransactionExpenseGroupField({
  transaction,
  categories,
  disabled = false,
  onChanged,
}: FieldProps) {
  const t = useTranslations("expenseGroups.share");
  const readOnly = useIsHouseholdViewer();
  const sharedKey = sharedGroupOf(transaction);
  const blocker = groupShareBlocker(transaction);
  const groupsQuery = useExpenseGroups();
  const [picking, setPicking] = useState(false);

  // Nothing to show: it cannot be shared, or a viewer could not share it.
  if (
    sharedKey === null &&
    (blocker === "unavailable" || blocker === "zero" || readOnly)
  ) {
    return null;
  }

  const groups = groupsQuery.data ?? [];
  const active = groups.filter((group) => !group.archived);
  const titleId = `edit-transaction-group-${transaction.transactionKey}`;

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <h3 id={titleId} className="flex items-center gap-2 text-sm font-medium">
        <Users className="text-muted-foreground size-4" aria-hidden />
        {t("title")}
      </h3>

      {sharedKey !== null ? (
        <SharedSummary
          transaction={transaction}
          groupKey={sharedKey}
          group={groups.find((group) => group.expenseGroupKey === sharedKey)}
          readOnly={readOnly}
          disabled={disabled}
          categories={categories}
          onChanged={onChanged}
        />
      ) : blocker !== null ? (
        <p className="text-muted-foreground text-xs">
          {t(`blocked-${blocker}`)}
        </p>
      ) : picking && active.length > 0 ? (
        <GroupShareEditor
          transaction={transaction}
          groups={active}
          start={startFor(active[0])}
          editing={false}
          categories={categories}
          disabled={disabled}
          onCancel={() => setPicking(false)}
          onSaved={onChanged}
        />
      ) : groupsQuery.isSuccess && active.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("no-groups")}{" "}
          <Link
            href="/groups"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("create-group")}
          </Link>
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{t("hint")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled || !groupsQuery.isSuccess}
            onClick={() => setPicking(true)}
          >
            <Users className="size-4" aria-hidden />
            {t("action")}
          </Button>
        </div>
      )}
    </section>
  );
}
