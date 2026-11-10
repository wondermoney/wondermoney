"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import useCurrencies from "@/lib/api/account/useCurrencies";
import useExchangeRateOverrides, {
  type ExchangeRateOverride,
  invalidateExchangeRateOverrides,
  useCreateExchangeRateOverride,
  useDeleteExchangeRateOverride,
  useEditExchangeRateOverride,
} from "@/lib/api/currency/useExchangeRateOverrides";
import { getApiErrorCode, isDemoReadOnlyError } from "@/lib/api/errors";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Spinner } from "../ui/Spinner";
import { Heading, Text } from "../ui/Typography";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** Tomorrow in UTC, `YYYY-MM-DD`: the latest day the API accepts. */
export function latestAllowedDay(now = new Date()): string {
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return new Date(tomorrow).toISOString().slice(0, 10);
}

/**
 * A typed rate as a number, or null when it is not a positive decimal. Both
 * `0.0015` and `0,0015` are read, since pt and es write a decimal comma; a
 * value with both separators is ambiguous and refused.
 */
export function parseRate(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A calendar day `YYYY-MM-DD` shown in the reader's short date format. */
function formatDay(day: string, locale: string) {
  // Noon local time, so no time zone moves the day across midnight.
  return formatShortDateForLocale(new Date(`${day}T12:00:00`), locale, {
    alwaysShowYear: true,
  });
}

function formatRate(rate: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumSignificantDigits: 10,
  }).format(rate);
}

interface Draft {
  fromCurrency: string;
  toCurrency: string;
  date: string;
  rate: string;
}

/**
 * The form a warning can open prefilled: `?tab=currencies&from=XOF&to=EUR&date=2026-03-02`.
 * Anything malformed in the link is ignored rather than shown.
 */
function draftFromLink(params: URLSearchParams): Draft {
  const pick = (key: string, pattern: RegExp) => {
    const value = params.get(key)?.trim().toUpperCase() ?? "";
    return pattern.test(value) ? value : "";
  };
  const date = params.get("date") ?? "";
  return {
    fromCurrency: pick("from", CURRENCY),
    toCurrency: pick("to", CURRENCY),
    date: DAY.test(date) ? date : "",
    rate: "",
  };
}

/**
 * Settings → Currencies: the household's own exchange rates. A rate set here
 * converts one currency pair from its day until the rate feed, or a later rate
 * of the household, has a newer one; on its own day it wins over the feed.
 * Both members of a household see and edit the same list.
 */
export default function Currencies() {
  const t = useTranslations("exchangeRates");
  const tRoot = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useExchangeRateOverrides();
  const currencies = useCurrencies();
  const createOverride = useCreateExchangeRateOverride();
  const editOverride = useEditExchangeRateOverride();
  const deleteOverride = useDeleteExchangeRateOverride();

  const [draft, setDraft] = useState<Draft>(() =>
    draftFromLink(new URLSearchParams(searchParams.toString())),
  );
  const [draftError, setDraftError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ExchangeRateOverride | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<ExchangeRateOverride | null>(null);

  const overrides = data?.overrides ?? [];
  // A link from a warning names the currency that could not be converted; the
  // other side is the member's own currency, which their amounts convert to.
  const ownCurrency = data?.currency ?? "";
  const target =
    draft.toCurrency ||
    (ownCurrency !== draft.fromCurrency ? ownCurrency : "");
  const form: Draft = { ...draft, toCurrency: target };
  const maxDay = latestAllowedDay();
  const pairOf = (override: ExchangeRateOverride) =>
    `${override.fromCurrency}/${override.toCurrency}`;

  const checkDay = (date: string) => {
    if (!DAY.test(date)) return t("errors.date-required");
    if (date > maxDay) return t("errors.date-future");
    return null;
  };

  const validateDraft = (value: Draft) => {
    if (!value.fromCurrency || !value.toCurrency)
      return t("errors.currency-required");
    if (value.fromCurrency === value.toCurrency)
      return t("errors.same-currency");
    return (
      checkDay(value.date) ??
      (parseRate(value.rate) === null ? t("errors.rate-invalid") : null)
    );
  };

  /** A refused write's message; `null` when a toast already said it. */
  const describeError = (error: unknown) => {
    if (getApiErrorCode(error) === "exchange_rate_override_exists")
      return t("errors.exists");
    if (isDemoReadOnlyError(error)) {
      toast.error(tRoot("demo-read-only-title"), {
        description: tRoot("demo-read-only-description"),
      });
      return null;
    }
    toast.error(t("save-error"));
    return null;
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateDraft(form);
    setDraftError(problem);
    const rate = parseRate(form.rate);
    if (problem || rate === null) return;
    try {
      await createOverride.mutateAsync({
        fromCurrency: form.fromCurrency,
        toCurrency: form.toCurrency,
        date: form.date,
        rate,
      });
      await invalidateExchangeRateOverrides(queryClient);
      toast.success(t("created"));
      setDraft({ ...form, date: "", rate: "" });
    } catch (error) {
      setDraftError(describeError(error));
    }
  };

  const startEditing = (override: ExchangeRateOverride) => {
    setEditing(override);
    setEditDate(override.date);
    setEditRate(String(override.rate));
    setEditError(null);
  };

  const onSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const rate = parseRate(editRate);
    const problem =
      checkDay(editDate) ?? (rate === null ? t("errors.rate-invalid") : null);
    setEditError(problem);
    if (problem || rate === null) return;
    try {
      await editOverride.mutateAsync({
        id: editing.id,
        ...(editDate !== editing.date ? { date: editDate } : {}),
        ...(rate !== editing.rate ? { rate } : {}),
      });
      await invalidateExchangeRateOverrides(queryClient);
      toast.success(t("updated"));
      setEditing(null);
    } catch (error) {
      setEditError(describeError(error));
    }
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOverride.mutateAsync(deleting.id);
      await invalidateExchangeRateOverrides(queryClient);
      toast.success(t("deleted"));
    } catch (error) {
      describeError(error);
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) return <Spinner />;

  const currencyOptions = currencies.data?.currencies ?? [];
  const currencySelect = (
    id: string,
    value: string,
    onChange: (code: string) => void,
  ) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="font-mono sm:w-40"
        aria-invalid={draftError !== null && !value}
      >
        <SelectValue placeholder={t("select-currency")} />
      </SelectTrigger>
      <SelectContent>
        {/* A prefilled code the list lacks still shows, so the link is not lost. */}
        {value && !currencyOptions.some((c) => c.code === value) ? (
          <SelectItem value={value}>{value}</SelectItem>
        ) : null}
        {currencyOptions.map((currency) => (
          <SelectItem key={currency.currencyKey} value={currency.code}>
            <span className="font-mono">{currency.code}</span>
            {currency.description ? (
              <span className="text-muted-foreground ml-2">
                {currency.description}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Heading variant="h2">{t("title")}</Heading>
        <Text variant="lead" className="text-sm">
          {t("description")}
        </Text>
        <Text className="text-muted-foreground text-sm">
          {t("how-it-applies")}
        </Text>
      </div>

      {isError ? (
        <div role="alert" className="flex items-center gap-3">
          <Text className="text-sm">{t("load-error")}</Text>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {tRoot("retry")}
          </Button>
        </div>
      ) : overrides.length === 0 ? (
        <Text className="text-muted-foreground text-sm">{t("empty")}</Text>
      ) : (
        <ul
          aria-label={t("table-label")}
          className="divide-border border-border divide-y rounded-md border"
        >
          {overrides.map((override) => {
            const day = formatDay(override.date, locale);
            return editing?.id === override.id ? (
              <li key={override.id} className="p-3">
                <form onSubmit={onSaveEdit} className="flex flex-col gap-3">
                  <Text className="font-mono text-sm">{pairOf(override)}</Text>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`edit-rate-date-${override.id}`}>
                        {t("date")}
                      </Label>
                      <Input
                        id={`edit-rate-date-${override.id}`}
                        type="date"
                        max={maxDay}
                        value={editDate}
                        onChange={(event) => setEditDate(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      <Label htmlFor={`edit-rate-value-${override.id}`}>
                        {t("rate")}
                      </Label>
                      <Input
                        id={`edit-rate-value-${override.id}`}
                        inputMode="decimal"
                        className="font-mono"
                        placeholder={t("rate-hint", {
                          from: override.fromCurrency,
                          to: override.toCurrency,
                        })}
                        value={editRate}
                        onChange={(event) => setEditRate(event.target.value)}
                        aria-invalid={editError !== null}
                        aria-describedby={
                          editError
                            ? `edit-rate-error-${override.id}`
                            : undefined
                        }
                      />
                    </div>
                  </div>
                  {editError ? (
                    <p
                      id={`edit-rate-error-${override.id}`}
                      role="alert"
                      className="text-destructive-text text-sm"
                    >
                      {editError}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      loading={editOverride.isPending}
                    >
                      {tRoot("save")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(null)}
                    >
                      {tRoot("cancel")}
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={override.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm tabular-nums">
                    {t("rate-reading", {
                      from: override.fromCurrency,
                      rate: formatRate(override.rate, locale),
                      to: override.toCurrency,
                    })}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {day}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit-named", {
                      pair: pairOf(override),
                      date: day,
                    })}
                    onClick={() => startEditing(override)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete-named", {
                      pair: pairOf(override),
                      date: day,
                    })}
                    onClick={() => setDeleting(override)}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={onCreate} className="space-y-4" noValidate>
        <Heading variant="h4">{t("add")}</Heading>
        {currencies.isError ? (
          <Text role="alert" className="text-sm">
            {t("currencies-load-error")}
          </Text>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-rate-from">{t("from")}</Label>
            {currencySelect("new-rate-from", draft.fromCurrency, (code) =>
              setDraft({ ...draft, fromCurrency: code }),
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-rate-to">{t("to")}</Label>
            {currencySelect("new-rate-to", form.toCurrency, (code) =>
              setDraft({ ...draft, toCurrency: code }),
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-rate-date">{t("date")}</Label>
            <Input
              id="new-rate-date"
              type="date"
              max={maxDay}
              value={draft.date}
              onChange={(event) =>
                setDraft({ ...draft, date: event.target.value })
              }
            />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="new-rate-value">{t("rate")}</Label>
            <Input
              id="new-rate-value"
              inputMode="decimal"
              className="font-mono"
              placeholder={t("rate-hint", {
                from: draft.fromCurrency || "…",
                to: form.toCurrency || "…",
              })}
              value={draft.rate}
              onChange={(event) =>
                setDraft({ ...draft, rate: event.target.value })
              }
              aria-invalid={draftError !== null}
              aria-describedby={draftError ? "new-rate-error" : undefined}
            />
          </div>
        </div>
        {draftError ? (
          <p
            id="new-rate-error"
            role="alert"
            className="text-destructive-text text-sm"
          >
            {draftError}
          </p>
        ) : null}
        <Button type="submit" loading={createOverride.isPending}>
          {t("add")}
        </Button>
      </form>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting
                ? t("delete-title", {
                    pair: pairOf(deleting),
                    date: formatDay(deleting.date, locale),
                  })
                : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
