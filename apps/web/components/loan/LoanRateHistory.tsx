"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import DatePicker from "@/components/ui/DatePicker";
import {
  Form,
  FormContent,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { RowsSkeleton, Section } from "@/components/ui/RuledSection";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type { LoanDetail, LoanRatePeriod } from "@/lib/api/loan/types";
import {
  useLoanRateMutations,
  useLoanRatePeriods,
} from "@/lib/api/loan/useLoanHistory";
import {
  formatDateInputValue,
  parseDateInputValue,
} from "@/lib/loans/calendar-day";
import { formatLocaleNumberInput, zLocaleNumber } from "@/lib/utils/number";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/**
 * A variable loan's rate changes. Each rate applies from its date until the next one; the
 * loan's own rate applies before the first. The schedule charges a month at the rate in force
 * when its period opened, and resizes the payment from the due date a new rate is in force.
 */
export default function LoanRateHistory({ loan }: { loan: LoanDetail }) {
  const t = useTranslations("loans.detail.rateHistory");
  const tCommon = useTranslations();
  const locale = useLocale();
  const formatShortDate = useFormatShortDate();
  const { data, isLoading, isError } = useLoanRatePeriods(loan.loanKey);
  const mutations = useLoanRateMutations(loan.loanKey);
  const [editing, setEditing] = useState<LoanRatePeriod | null>(null);
  const periods = data?.ratePeriods ?? [];

  const schema = useMemo(
    () =>
      z.object({
        effectiveDate: z.string().min(1, t("invalidDate")),
        ratePercent: zLocaleNumber(locale, t("invalidRate")).pipe(
          z.number().min(0, t("maxRate")).max(100, t("maxRate")),
        ),
      }),
    [t, locale],
  );
  type FormInput = z.input<typeof schema>;
  type FormValues = z.output<typeof schema>;
  const empty: FormInput = { effectiveDate: "", ratePercent: "" };
  const form = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: empty,
  });

  const reportError = (error: unknown) =>
    toast.error(
      isDemoReadOnlyError(error)
        ? tCommon("demo-read-only-title")
        : (getApiErrorMessage(error) ?? t("saveError")),
    );
  const stopEditing = () => {
    setEditing(null);
    form.reset(empty);
  };
  const startEditing = (period: LoanRatePeriod) => {
    setEditing(period);
    form.reset({
      effectiveDate: period.effectiveDate.slice(0, 10),
      ratePercent: period.annualInterestRateBps / 100,
    });
  };
  const submit = async (values: FormValues) => {
    const body = {
      effectiveDate: values.effectiveDate,
      annualInterestRateBps: Math.round(values.ratePercent * 100),
    };
    try {
      if (editing)
        await mutations.update.mutateAsync({
          key: editing.loanRatePeriodKey,
          body,
        });
      else await mutations.create.mutateAsync(body);
      stopEditing();
    } catch (error) {
      reportError(error);
    }
  };
  const remove = async (period: LoanRatePeriod) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      await mutations.remove.mutateAsync(period.loanRatePeriodKey);
      if (editing?.loanRatePeriodKey === period.loanRatePeriodKey)
        stopEditing();
    } catch (error) {
      reportError(error);
    }
  };
  const percent = (bps: number) =>
    `${formatLocaleNumberInput(bps / 100, locale)}%`;

  return (
    <Section id="loan-rate-history-heading" title={t("title")} busy={isLoading}>
      <p className="text-muted-foreground mb-4 text-sm">{t("description")}</p>
      {isLoading ? (
        <RowsSkeleton rows={2} />
      ) : isError ? (
        <p role="alert" className="text-destructive-text text-sm">
          {t("loadError")}
        </p>
      ) : periods.length === 0 ? (
        <p className="text-muted-foreground border-border border-b pb-4 text-sm">
          {loan.initialAnnualInterestRateBps != null
            ? t("emptyWithRate", {
                rate: percent(loan.initialAnnualInterestRateBps),
              })
            : t("empty")}
        </p>
      ) : (
        <ul>
          {periods.map((period) => {
            const date = parseDateInputValue(period.effectiveDate);
            return (
              <li
                key={period.loanRatePeriodKey}
                className="border-border flex min-h-14 items-center justify-between gap-3 border-b py-2 text-sm"
              >
                <span>
                  {t.rich("from", {
                    date: date ? formatShortDate(date) : "",
                    rate: () => (
                      <span className="font-mono">
                        {percent(period.annualInterestRateBps)}
                      </span>
                    ),
                  })}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit")}
                    onClick={() => startEditing(period)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete")}
                    disabled={mutations.remove.isPending}
                    onClick={() => void remove(period)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Form {...form}>
        <FormContent
          className="mt-4"
          aria-label={editing ? t("save") : t("add")}
          onSubmit={form.handleSubmit(submit)}
        >
          <FormField
            control={form.control}
            name="effectiveDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel required>{t("effectiveDate")}</FormLabel>
                <DatePicker
                  form
                  value={parseDateInputValue(field.value)}
                  onSelect={(date) =>
                    field.onChange(formatDateInputValue(date))
                  }
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ratePercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("apr")}</FormLabel>
                <FormControl>
                  <Input
                    inputMode="decimal"
                    className="text-right font-mono"
                    endAdornment={<span className="font-mono">%</span>}
                    {...field}
                    value={formatLocaleNumberInput(field.value, locale)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              loading={mutations.create.isPending || mutations.update.isPending}
            >
              {editing ? t("save") : t("add")}
            </Button>
            {editing ? (
              <Button type="button" variant="ghost" onClick={stopEditing}>
                {t("cancel")}
              </Button>
            ) : null}
          </div>
        </FormContent>
      </Form>
    </Section>
  );
}
