"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { MoneyInput } from "@/components/ui/MoneyInput";
import {
  defaultLinkUnits,
  effectiveAmount,
  linkedTransactionTitle,
  otherSideOf,
  reimbursementErrorKey,
  reimbursementRoleOf,
} from "@/lib/account/transaction-reimbursement";
import {
  formatUnitsForInput,
  parseSplitLineAmount,
  unitsToNumber,
} from "@/lib/account/transaction-split";
import {
  invalidateTransactionReimbursements,
  type ReimbursementLink,
  type ReimbursementRole,
  type ReimbursementSuggestion,
  useLinkReimbursement,
  useReimbursementSuggestions,
  useTransactionReimbursements,
  useUnlinkReimbursement,
} from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { sharedGroupOf } from "@/lib/expense-group/expense-group";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { LinkedTransactionSummary } from "./TransactionReimbursementBadge";

const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

/** Enter in a field of the picker must not submit the edit sheet's form around it. */
const keepEnterInPicker = (
  event: React.KeyboardEvent<HTMLInputElement>,
  onEnter?: () => void,
) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onEnter?.();
};

/** The toast for a refused write that is not a reimbursement rule (demo, 429). */
function useNotifyWriteError() {
  const tRoot = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  return (error: unknown): boolean => {
    if (notifyIfRateLimited(error)) return true;
    if (isDemoReadOnlyError(error)) {
      toast.error(tRoot("demo-read-only-title"), {
        description: tRoot("demo-read-only-description"),
      });
      return true;
    }
    return false;
  };
}

interface PickerProps {
  transactionKey: number;
  role: ReimbursementRole;
  currency: string;
  /** What this transaction still has free to link. */
  ownRemaining: number;
  disabled: boolean;
  onCancel: () => void;
  onLinked: () => void;
}

/**
 * Choosing the other side of a new link: the API's suggestions (or a search), then the amount,
 * which starts at as much as both transactions still have free.
 */
function ReimbursementPicker({
  transactionKey,
  role,
  currency,
  ownRemaining,
  disabled,
  onCancel,
  onLinked,
}: PickerProps) {
  const t = useTranslations("transactionReimbursement");
  const locale = useLocale();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const formatCurrency = useFormatCurrency();
  const notifyWriteError = useNotifyWriteError();
  const link = useLinkReimbursement();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const suggestions = useReimbursementSuggestions(
    transactionKey,
    debouncedSearch,
  );
  const [selected, setSelected] = useState<ReimbursementSuggestion | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const maxUnits = selected
    ? defaultLinkUnits(ownRemaining, selected.remainingAmount)
    : 0n;
  const parsed = useMemo(
    () => parseSplitLineAmount(amount, maxUnits, locale),
    [amount, locale, maxUnits],
  );
  const amountError =
    parsed.error ??
    (parsed.units === null
      ? "invalid"
      : parsed.units > maxUnits
        ? "too-large"
        : null);
  const showAmountError = submitted && amountError !== null;

  const choose = (suggestion: ReimbursementSuggestion) => {
    setSelected(suggestion);
    setAmount(
      formatUnitsForInput(
        defaultLinkUnits(ownRemaining, suggestion.remainingAmount),
        locale,
      ),
    );
    setSubmitted(false);
    setRefusal(null);
  };

  const submit = async () => {
    setSubmitted(true);
    if (!selected || amountError !== null || parsed.units === null) return;
    setRefusal(null);
    try {
      await link.mutateAsync(
        role === "reimbursement"
          ? {
              reimbursementTransactionKey: transactionKey,
              expenseTransactionId: selected.transactionKey,
              amount: unitsToNumber(parsed.units),
            }
          : {
              reimbursementTransactionKey: selected.transactionKey,
              expenseTransactionId: transactionKey,
              amount: unitsToNumber(parsed.units),
            },
      );
    } catch (error) {
      if (notifyWriteError(error)) return;
      const key = reimbursementErrorKey(error);
      setRefusal(key ? t(`errors.${key}`) : t("errors.link"));
      return;
    }
    posthog.capture("transaction_reimbursement_linked", {
      from: role,
      reason: selected.reason,
    });
    await invalidateTransactionReimbursements(queryClient, [
      transactionKey,
      selected.transactionKey,
    ]);
    toast.success(t("linked"));
    onLinked();
  };

  const list = suggestions.data ?? [];
  const busy = disabled || link.isPending;
  const amountErrorId = `reimbursement-amount-error-${transactionKey}`;

  return (
    <div className="bg-muted space-y-3 rounded-md p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(`picker-${role}`)}</p>
        <p className="text-muted-foreground text-xs">
          {t(`currency-hint-${role}`, { currency })}
        </p>
      </div>
      <Input
        type="search"
        aria-label={t("search-label")}
        placeholder={t("search-placeholder")}
        className="h-9 px-3"
        disabled={busy}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => keepEnterInPicker(event)}
      />
      {suggestions.isPending ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {t("loading")}
        </p>
      ) : suggestions.isError ? (
        <p className="text-destructive-text text-xs">{t("errors.load")}</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {debouncedSearch
            ? t("empty-search", { search: debouncedSearch })
            : t(`empty-${role}`)}
        </p>
      ) : (
        <ul className="divide-border bg-background divide-y rounded-md border">
          {list.map((suggestion) => {
            const isSelected =
              selected?.transactionKey === suggestion.transactionKey;
            const partlyLinked =
              suggestion.settlementAmount !== null &&
              suggestion.remainingAmount <
                Math.abs(suggestion.settlementAmount);
            return (
              <li key={suggestion.transactionKey}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  disabled={busy}
                  className={cn(
                    "focus-visible:ring-ring flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    isSelected ? "bg-accent" : "hover:bg-accent",
                  )}
                  onClick={() => choose(suggestion)}
                >
                  <LinkedTransactionSummary
                    transaction={suggestion}
                    extra={
                      suggestion.reason === "merchant"
                        ? t("reason-merchant")
                        : null
                    }
                  />
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <Amount
                      value={suggestion.settlementAmount}
                      currency={suggestion.currencyCode ?? currency}
                      className="font-mono text-sm"
                    />
                    {partlyLinked ? (
                      <span className="text-muted-foreground text-xs">
                        {t("left-to-link")}{" "}
                        <Amount
                          value={suggestion.remainingAmount}
                          currency={suggestion.currencyCode ?? currency}
                          className="font-mono"
                        />
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="space-y-1">
          <Label htmlFor={`reimbursement-amount-${transactionKey}`}>
            {t("amount")}
          </Label>
          <MoneyInput
            id={`reimbursement-amount-${transactionKey}`}
            className="h-9 px-3"
            currency={currency}
            disabled={busy}
            value={amount}
            onEvaluated={setAmount}
            aria-invalid={showAmountError ? true : undefined}
            aria-describedby={showAmountError ? amountErrorId : undefined}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => keepEnterInPicker(event, () => void submit())}
          />
          {showAmountError ? (
            <p id={amountErrorId} className="text-destructive-text text-xs">
              {t(`amount-errors.${amountError}`)}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("amount-hint", {
                amount: formatCurrency(unitsToNumber(maxUnits), currency),
              })}
            </p>
          )}
        </div>
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
          loading={link.isPending}
          disabled={busy || !selected}
          onClick={() => void submit()}
        >
          {t("link")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={link.isPending}
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

interface SectionProps {
  transaction: Transaction;
  role: ReimbursementRole;
  disabled: boolean;
}

function ReimbursementSection({ transaction, role, disabled }: SectionProps) {
  const t = useTranslations("transactionReimbursement");
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const notifyWriteError = useNotifyWriteError();
  const transactionKey = transaction.transactionKey;
  const query = useTransactionReimbursements(transactionKey);
  const unlink = useUnlinkReimbursement();
  const [picking, setPicking] = useState(false);

  const links = query.data?.links ?? [];
  const currency =
    query.data?.currencyCode ?? transaction.settlementCurrencyKey.code;
  const remaining =
    query.data?.remainingAmount ?? Math.abs(effectiveAmount(transaction));
  const titleId = `edit-transaction-reimbursements-${transactionKey}`;

  const onUnlink = async (link: ReimbursementLink) => {
    try {
      await unlink.mutateAsync({
        transactionKey,
        transactionReimbursementKey: link.transactionReimbursementKey,
      });
    } catch (error) {
      if (notifyWriteError(error)) return;
      const key = reimbursementErrorKey(error);
      toast.error(key ? t(`errors.${key}`) : t("errors.unlink"), {
        duration: 9000,
      });
      return;
    }
    posthog.capture("transaction_reimbursement_unlinked", { from: role });
    await invalidateTransactionReimbursements(queryClient, [
      link.expense.transactionKey,
      link.reimbursement.transactionKey,
    ]);
    toast.success(t("unlinked"));
  };

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <h3 id={titleId} className="flex items-center gap-2 text-sm font-medium">
        <Undo2 className="text-muted-foreground size-4" aria-hidden />
        {t(`title-${role}`)}
      </h3>

      {query.isError ? (
        <p className="text-destructive-text text-xs">{t("errors.load")}</p>
      ) : null}

      {links.length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            {role === "expense" ? t("reimbursed-by") : t("reimburses")}
          </p>
          <ul className="divide-border divide-y">
            {links.map((link) => {
              const other = otherSideOf(link, transactionKey);
              return (
                <li
                  key={link.transactionReimbursementKey}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <LinkedTransactionSummary transaction={other} />
                  <div className="flex shrink-0 items-center gap-1">
                    <Amount
                      value={link.amount}
                      currency={link.currencyCode}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={t("unlink-label", {
                        name: linkedTransactionTitle(other) ?? "—",
                      })}
                      disabled={disabled || unlink.isPending}
                      onClick={() => void onUnlink(link)}
                    >
                      {t("unlink")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {role === "expense" ? t("net-spend") : t("still-income")}
            </span>
            <Amount
              value={remaining}
              currency={currency}
              className="font-mono"
            />
          </div>
        </div>
      ) : null}

      {picking ? (
        <ReimbursementPicker
          transactionKey={transactionKey}
          role={role}
          currency={currency}
          ownRemaining={remaining}
          disabled={disabled}
          onCancel={() => setPicking(false)}
          onLinked={() => setPicking(false)}
        />
      ) : remaining > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{t(`hint-${role}`)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled || !query.data}
            onClick={() => setPicking(true)}
          >
            {role === "reimbursement" ? t("mark") : t("find")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t(`fully-linked-${role}`)}
        </p>
      )}
    </section>
  );
}

/**
 * The edit sheet's reimbursement part. On money in: "Mark as reimbursement", which links it to
 * the expense it pays back. On an expense: what reimbursed it, and "Link a reimbursement". Both
 * list the links with "Unlink". Links save at once, apart from the sheet's Save. Nothing shows
 * for what cannot be linked: a transfer, a loan repayment, a zero amount.
 */
export function TransactionReimbursementField({
  transaction,
  disabled = false,
}: {
  transaction: Transaction;
  disabled?: boolean;
}) {
  const role = reimbursementRoleOf(transaction);
  // A transaction shared in an expense group plays that part only (the API answers 409
  // `transaction_in_expense_group` to a link).
  if (!role || sharedGroupOf(transaction) !== null) return null;
  return (
    <ReimbursementSection
      transaction={transaction}
      role={role}
      disabled={disabled}
    />
  );
}
