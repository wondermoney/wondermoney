"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import useCurrencies from "@/lib/api/account/useCurrencies";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  CreateLoanRequest,
  LoanDetail,
  LoanListItem,
  LoanType,
} from "@/lib/api/loan/types";
import useCreateLoan from "@/lib/api/loan/useCreateLoan";
import useUpdateLoan from "@/lib/api/loan/useUpdateLoan";
import { LOAN_TYPE_LABEL_KEY } from "@/lib/loans/loan-labels";

/**
 * Convert a `yyyy-mm-dd` string into a local Date, avoiding the UTC-midnight
 * parsing of `new Date("yyyy-mm-dd")` that can shift the day in negative-offset zones.
 */
function parseDateInputValue(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Format a Date back into the `yyyy-mm-dd` string the API expects. */
function formatDateInputValue(date: Date | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Derive a `yyyy-mm-dd` maturity date by adding `termMonths` whole months to
 * `openingBalanceDate`. The backend has no server-side derivation of its own
 * (maturityDate is purely optional there) and rejects an empty string, so
 * when we can compute a sensible value from the term we send it; otherwise
 * we omit the field entirely rather than send `""`.
 */
function computeMaturityDate(
  openingBalanceDate: string,
  termMonths: number | undefined,
): string | undefined {
  if (!termMonths) return undefined;
  const start = parseDateInputValue(openingBalanceDate);
  if (!start) return undefined;
  const maturity = new Date(
    start.getFullYear(),
    start.getMonth() + termMonths,
    start.getDate(),
  );
  return formatDateInputValue(maturity);
}

function buildBaseSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().min(1, t("validation.required")),
    type: z.enum([
      "MORTGAGE",
      "AUTO_LOAN",
      "PERSONAL_LOAN",
      "STUDENT_LOAN",
      "OTHER",
    ]),
    providerName: z.string().optional(),
    currencyKey: z.coerce.number().int().positive(),
    openingPrincipalBalance: z.coerce.number().min(0),
    openingBalanceDate: z.string().min(1, t("validation.required")),
    // Amount originally borrowed at origination — distinct from, and
    // optionally greater than or equal to, openingPrincipalBalance (the
    // balance as of openingBalanceDate). See the cross-field check below.
    originalPrincipal: z.coerce.number().min(0).optional(),
    regularPaymentAmount: z.coerce.number().positive().optional(),
    // Entered as a percentage (e.g. 3.5 for 3.5%); converted to the
    // basis-points integer the API expects (`annualInterestRateBps`) on
    // submit — see `submit()`.
    interestRatePercent: z.coerce.number().min(0).max(100).optional(),
    paymentDayOfMonth: z.coerce.number().min(1).max(31).optional(),
    termMonths: z.coerce.number().int().positive().optional(),
    includeInNetWorth: z.boolean(),
    notes: z.string().optional(),
  });
}
type FormValues = z.infer<ReturnType<typeof buildBaseSchema>>;
export default function LoanFormDrawer({
  open,
  onOpenChange,
  loan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan?: LoanListItem | LoanDetail | null;
}) {
  const t = useTranslations("loans");
  const tCommon = useTranslations();
  const createMutation = useCreateLoan();
  const updateMutation = useUpdateLoan();
  const { data: currenciesData } = useCurrencies({ enabled: open });
  const currencies = currenciesData?.currencies ?? [];
  const defaultValues = useMemo<FormValues>(
    () => ({
      name: loan?.name ?? "",
      type: loan?.type ?? "PERSONAL_LOAN",
      providerName: loan?.providerName ?? "",
      currencyKey: loan?.currency.currencyKey ?? 1,
      openingPrincipalBalance: loan?.openingPrincipalBalance ?? 0,
      openingBalanceDate:
        (loan as LoanDetail | undefined)?.openingBalanceDate?.slice(0, 10) ??
        (loan ? "" : formatDateInputValue(new Date())),
      // Leave unset by default rather than defaulting to 0 — 0 would fail
      // the backend's originalPrincipal >= openingPrincipalBalance check
      // for any loan with a positive balance, and the field is genuinely
      // optional (see the schema comment above).
      originalPrincipal: loan?.originalPrincipal ?? undefined,
      regularPaymentAmount: loan?.regularPaymentAmount ?? undefined,
      // annualInterestRateBps is stored server-side as basis points; the
      // form field is a percentage, so convert on the way in (divide by
      // 100) and back on the way out (multiply by 100, see `submit()`).
      interestRatePercent:
        loan?.annualInterestRateBps != null
          ? loan.annualInterestRateBps / 100
          : undefined,
      paymentDayOfMonth: loan?.paymentDayOfMonth ?? 1,
      termMonths: loan?.termMonths ?? undefined,
      includeInNetWorth: loan?.includeInNetWorth ?? true,
      notes: loan?.notes ?? "",
    }),
    [loan],
  );
  const schema = useMemo(
    () =>
      buildBaseSchema(t).superRefine((data, ctx) => {
        if (
          data.originalPrincipal != null &&
          data.originalPrincipal < data.openingPrincipalBalance
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("validation.originalPrincipalTooLow"),
            path: ["originalPrincipal"],
          });
        }
      }),
    [t],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);
  const submit = async (values: FormValues) => {
    const payload: CreateLoanRequest = {
      name: values.name,
      type: values.type,
      providerName: values.providerName || undefined,
      currencyKey: values.currencyKey,
      openingPrincipalBalance: values.openingPrincipalBalance,
      openingBalanceDate: values.openingBalanceDate,
      originalPrincipal: values.originalPrincipal ?? undefined,
      regularPaymentAmount: values.regularPaymentAmount ?? undefined,
      // Percent -> basis points; the API stores an integer number of bps.
      annualInterestRateBps:
        values.interestRatePercent != null
          ? Math.round(values.interestRatePercent * 100)
          : undefined,
      paymentDayOfMonth: values.paymentDayOfMonth ?? undefined,
      termMonths: values.termMonths ?? undefined,
      // No maturityDate input exists in this form yet; derive it from the
      // term when possible instead of ever sending "" (see
      // `computeMaturityDate`'s comment for why the empty string breaks
      // the backend's date parser).
      maturityDate: computeMaturityDate(
        values.openingBalanceDate,
        values.termMonths,
      ),
      includeInNetWorth: values.includeInNetWorth,
      notes: values.notes || undefined,
    };
    try {
      if (loan)
        await updateMutation.mutateAsync({
          loanId: loan.loanKey,
          payload,
        });
      else await createMutation.mutateAsync(payload);
      onOpenChange(false);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tCommon("demo-read-only-title"), {
          description: tCommon("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }

      toast.error(getApiErrorMessage(error) ?? tCommon("server-error"));
    }
  };
  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={loan ? t("actions.edit") : t("actions.add")}
      footer={
        <Button
          form="loan-form"
          type="submit"
          loading={createMutation.isPending || updateMutation.isPending}
        >
          {loan ? t("actions.edit") : t("actions.add")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent
          id="loan-form"
          onSubmit={form.handleSubmit(submit)}
          className="space-y-4"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.name")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.type")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(
                      [
                        "MORTGAGE",
                        "AUTO_LOAN",
                        "PERSONAL_LOAN",
                        "STUDENT_LOAN",
                        "OTHER",
                      ] satisfies LoanType[]
                    ).map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`types.${LOAN_TYPE_LABEL_KEY[v]}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currencyKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.currency")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={String(field.value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {currencies.map((currency) => (
                      <SelectItem
                        key={currency.currencyKey}
                        value={String(currency.currencyKey)}
                      >
                        {currency.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="openingPrincipalBalance"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.principal")}</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="originalPrincipal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.originalPrincipal")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : e.target.value,
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t("fields.originalPrincipalHint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="regularPaymentAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.installment")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : e.target.value,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="interestRatePercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.interestRate")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : e.target.value,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="termMonths"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.termMonths")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? undefined : e.target.value,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="openingBalanceDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel required>{t("fields.startDate")}</FormLabel>
                <DatePicker
                  form
                  inModal
                  value={parseDateInputValue(field.value)}
                  onSelect={(date) =>
                    field.onChange(formatDateInputValue(date))
                  }
                  placeholder={t("fields.startDate")}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="includeInNetWorth"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between">
                <FormLabel>{t("fields.includeInNetWorth")}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.notes")}</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}
