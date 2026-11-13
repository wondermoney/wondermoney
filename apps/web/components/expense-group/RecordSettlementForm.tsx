"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LinkedTransactionSummary } from "@/components/account/TransactionReimbursementBadge";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Textarea } from "@/components/ui/textarea";
import {
  amountToUnits,
  formatUnitsForInput,
  parseSplitLineAmount,
  unitsToNumber,
} from "@/lib/account/transaction-split";
import useCurrencies from "@/lib/api/account/useCurrencies";
import type {
  ExpenseGroup,
  SettlementSuggestion,
} from "@/lib/api/expense-group/types";
import {
  useRecordSettlement,
  useSettlementSuggestions,
} from "@/lib/api/expense-group/useExpenseGroups";
import { canLinkSettlement } from "@/lib/expense-group/expense-group";
import { formatDateInputValue } from "@/lib/loans/calendar-day";
import { cn } from "@/lib/utils";

import {
  keepEnterInside,
  selectClassName,
  useGroupErrorMessage,
} from "./shared";

const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

/** A suggested payment to record, or nothing for a blank form. */
export interface SettlementPrefill {
  fromMemberKey: number;
  toMemberKey: number;
  /** Positive. */
  amount: number;
  currencyCode: string;
}

interface Props {
  group: ExpenseGroup;
  prefill?: SettlementPrefill | null;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * "Record settlement": someone paid someone back. From, to, the amount, the day and currency
 * (the group's by default), notes, and, when money crossed the household's edge (exactly one of
 * the two is someone of the household), the transaction that moved it, picked from the API's
 * suggestions or a search. A linked transaction stops counting as income or spending.
 */
export function RecordSettlementForm({
  group,
  prefill,
  onDone,
  onCancel,
}: Props) {
  const t = useTranslations("expenseGroups.settlement");
  const tRoot = useTranslations();
  const locale = useLocale();
  const posthog = usePostHog();
  const errorMessage = useGroupErrorMessage();
  const record = useRecordSettlement(group.expenseGroupKey);
  const currencies = useCurrencies();
  const members = group.members;

  const [fromKey, setFromKey] = useState<number>(
    prefill?.fromMemberKey ?? members[0]?.expenseGroupMemberKey ?? 0,
  );
  const [toKey, setToKey] = useState<number>(
    prefill?.toMemberKey ??
      members[1]?.expenseGroupMemberKey ??
      members[0]?.expenseGroupMemberKey ??
      0,
  );
  const [amount, setAmount] = useState(
    prefill ? formatUnitsForInput(amountToUnits(prefill.amount), locale) : "",
  );
  const [currency, setCurrency] = useState(
    prefill?.currencyCode ?? group.currencyCode,
  );
  const [settledOn, setSettledOn] = useState(() =>
    formatDateInputValue(new Date()),
  );
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const [linked, setLinked] = useState<SettlementSuggestion | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const linkable = canLinkSettlement(members, fromKey, toKey);
  const suggestions = useSettlementSuggestions(
    group.expenseGroupKey,
    {
      fromMemberId: fromKey,
      toMemberId: toKey,
      currencyCode: currency,
      search: debouncedSearch,
    },
    { enabled: linkable },
  );

  const parsed = parseSplitLineAmount(amount, 1n, locale);
  const samePerson = fromKey === toKey;
  const amountError = parsed.units === null || parsed.error !== null;
  const dateMissing = settledOn === "";
  const busy = record.isPending;

  const currencyCodes = Array.from(
    new Set([
      currency,
      group.currencyCode,
      ...(currencies.data?.currencies ?? []).map((c) => c.code),
    ]),
  );

  // Who and what currency decide which transactions fit; a choice made for others goes.
  const changePeople = (from: number, to: number) => {
    setFromKey(from);
    setToKey(to);
    setLinked(null);
  };

  const choose = (suggestion: SettlementSuggestion) => {
    setLinked(suggestion);
    if (amount.trim() === "") {
      setAmount(
        formatUnitsForInput(amountToUnits(suggestion.remainingAmount), locale),
      );
    }
  };

  const submit = async () => {
    setSubmitted(true);
    if (samePerson || amountError || dateMissing) return;
    setRefusal(null);
    try {
      await record.mutateAsync({
        fromMemberId: fromKey,
        toMemberId: toKey,
        amount: unitsToNumber(parsed.units!),
        settledOn,
        currencyCode: currency,
        notes: notes.trim() || null,
        transactionId: linkable && linked ? linked.transactionKey : null,
      });
    } catch (error) {
      setRefusal(errorMessage(error));
      return;
    }
    posthog.capture("expense_group_settlement_recorded", {
      linked: Boolean(linkable && linked),
      suggested: Boolean(prefill),
    });
    toast.success(t("recorded"));
    onDone();
  };

  const list = suggestions.data ?? [];
  const id = (name: string) => `settlement-${group.expenseGroupKey}-${name}`;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id("from")}>{t("from")}</Label>
          <select
            id={id("from")}
            className={selectClassName}
            disabled={busy}
            value={fromKey}
            onChange={(event) =>
              changePeople(Number(event.target.value), toKey)
            }
          >
            {members.map((member) => (
              <option
                key={member.expenseGroupMemberKey}
                value={member.expenseGroupMemberKey}
              >
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("to")}>{t("to")}</Label>
          <select
            id={id("to")}
            className={selectClassName}
            disabled={busy}
            value={toKey}
            aria-invalid={submitted && samePerson ? true : undefined}
            onChange={(event) =>
              changePeople(fromKey, Number(event.target.value))
            }
          >
            {members.map((member) => (
              <option
                key={member.expenseGroupMemberKey}
                value={member.expenseGroupMemberKey}
              >
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {submitted && samePerson ? (
        <p className="text-destructive-text text-xs">{t("same-person")}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1">
          <Label htmlFor={id("amount")}>{t("amount")}</Label>
          <MoneyInput
            id={id("amount")}
            currency={currency}
            disabled={busy}
            value={amount}
            aria-invalid={submitted && amountError ? true : undefined}
            onEvaluated={setAmount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {submitted && amountError ? (
            <p className="text-destructive-text text-xs">
              {t("amount-invalid")}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("currency")}>{t("currency")}</Label>
          <select
            id={id("currency")}
            className={selectClassName}
            disabled={busy}
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setLinked(null);
            }}
          >
            {currencyCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={id("date")}>{t("date")}</Label>
        <Input
          id={id("date")}
          type="date"
          disabled={busy}
          value={settledOn}
          aria-invalid={submitted && dateMissing ? true : undefined}
          onChange={(event) => setSettledOn(event.target.value)}
        />
        {submitted && dateMissing ? (
          <p className="text-destructive-text text-xs">{t("date-required")}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={id("notes")}>{t("notes")}</Label>
        <Textarea
          id={id("notes")}
          disabled={busy}
          value={notes}
          maxLength={500}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {linkable ? (
        <section
          className="bg-muted space-y-3 rounded-md p-3"
          aria-labelledby={id("link")}
        >
          <div className="space-y-1">
            <h3 id={id("link")} className="text-sm font-medium">
              {t("link-title")}
            </h3>
            <p className="text-muted-foreground text-xs">{t("link-hint")}</p>
          </div>
          <Input
            type="search"
            aria-label={t("search")}
            placeholder={t("search-placeholder")}
            className="h-9 px-3"
            disabled={busy}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => keepEnterInside(event)}
          />
          {suggestions.isPending ? (
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {t("loading")}
            </p>
          ) : suggestions.isError ? (
            <p className="text-destructive-text text-xs">
              {t("suggestions-error")}
            </p>
          ) : list.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("no-suggestions")}
            </p>
          ) : (
            <ul className="divide-border bg-background divide-y rounded-md border">
              {list.map((suggestion) => {
                const selected =
                  linked?.transactionKey === suggestion.transactionKey;
                const partly =
                  suggestion.settlementAmount !== null &&
                  suggestion.remainingAmount <
                    Math.abs(suggestion.settlementAmount);
                return (
                  <li key={suggestion.transactionKey}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={busy}
                      className={cn(
                        "focus-visible:ring-ring flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        selected ? "bg-accent" : "hover:bg-accent",
                      )}
                      onClick={() =>
                        selected ? setLinked(null) : choose(suggestion)
                      }
                    >
                      <LinkedTransactionSummary transaction={suggestion} />
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <Amount
                          value={suggestion.settlementAmount}
                          currency={suggestion.currencyCode ?? currency}
                          className="font-mono text-sm"
                        />
                        {partly ? (
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
          {linked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setLinked(null)}
            >
              {t("unlink")}
            </Button>
          ) : null}
        </section>
      ) : null}

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
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
