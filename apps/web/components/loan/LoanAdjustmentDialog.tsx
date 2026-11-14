"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import DatePicker from "@/components/ui/DatePicker";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormContent,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  LoanAdjustment,
  LoanAdjustmentType,
  LoanDetail,
} from "@/lib/api/loan/types";
import { useLoanAdjustmentMutations } from "@/lib/api/loan/useLoanHistory";
import {
  formatDateInputValue,
  parseDateInputValue,
} from "@/lib/loans/calendar-day";
import { zLocaleNumber } from "@/lib/utils/number";

export const ADJUSTMENT_TYPES = [
  "BALANCE_CORRECTION",
  "FEE",
  "CAPITALIZED_INTEREST",
  "PRINCIPAL_INCREASE",
  "PRINCIPAL_DECREASE",
  "WRITE_OFF",
] as const satisfies readonly LoanAdjustmentType[];

/**
 * Records a lender balance correction or another change to the balance, or edits one. A
 * correction sets the balance on its date (zero is a valid balance); every other type moves it
 * by a positive amount.
 */
export default function LoanAdjustmentDialog({
  open,
  onOpenChange,
  loan,
  adjustment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: LoanDetail;
  /** The adjustment to edit; none to add one. */
  adjustment?: LoanAdjustment | null;
}) {
  const t = useTranslations("loans.detail.adjustment");
  const tCommon = useTranslations();
  const locale = useLocale();
  const mutations = useLoanAdjustmentMutations(loan.loanKey);

  const schema = useMemo(
    () =>
      z
        .object({
          type: z.enum(ADJUSTMENT_TYPES),
          effectiveDate: z.string().min(1, t("invalidDate")),
          amount: zLocaleNumber(locale, t("invalidAmount")).pipe(
            z.number().min(0, t("invalidAmount")),
          ),
          reason: z.string().max(1000),
        })
        .superRefine((values, ctx) => {
          if (values.type !== "BALANCE_CORRECTION" && values.amount <= 0) {
            ctx.addIssue({
              code: "custom",
              message: t("amountPositive"),
              path: ["amount"],
            });
          }
        }),
    [t, locale],
  );
  type FormInput = z.input<typeof schema>;
  type FormValues = z.output<typeof schema>;

  const defaultValues = useMemo<FormInput>(
    () => ({
      type: adjustment?.type ?? "BALANCE_CORRECTION",
      effectiveDate: adjustment
        ? adjustment.effectiveDate.slice(0, 10)
        : formatDateInputValue(new Date()),
      amount: adjustment?.amount ?? "",
      reason: adjustment?.reason ?? "",
    }),
    [adjustment],
  );
  const form = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);
  const type = useWatch({ control: form.control, name: "type" });

  const submit = async (values: FormValues) => {
    const body = {
      type: values.type,
      effectiveDate: values.effectiveDate,
      amount: values.amount,
      reason: values.reason.trim() || null,
    };
    try {
      if (adjustment)
        await mutations.update.mutateAsync({
          key: adjustment.loanAdjustmentKey,
          body,
        });
      else await mutations.create.mutateAsync(body);
      onOpenChange(false);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tCommon("demo-read-only-title"), {
          description: tCommon("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      toast.error(getApiErrorMessage(error) ?? t("saveError"));
    }
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={adjustment ? t("editTitle") : t("title")}
      description={t("description")}
      footer={
        <Button
          form="loan-adjustment-form"
          type="submit"
          loading={mutations.create.isPending || mutations.update.isPending}
        >
          {adjustment ? t("save") : t("add")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent
          id="loan-adjustment-form"
          onSubmit={form.handleSubmit(submit)}
        >
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("type")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ADJUSTMENT_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`types.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>{t(`typeHelp.${type}`)}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="effectiveDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel required>{t("date")}</FormLabel>
                <DatePicker
                  form
                  inModal
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
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>
                  {type === "BALANCE_CORRECTION"
                    ? t("balanceAmount")
                    : t("amount")}
                </FormLabel>
                <FormControl>
                  <MoneyInput
                    {...field}
                    currency={loan.currency.code}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("reason")}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={1000} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}
