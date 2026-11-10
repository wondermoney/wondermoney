"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  ManualAsset,
  ManualAssetValuation,
} from "@/lib/api/manual-asset/types";
import { useSaveValuation } from "@/lib/api/manual-asset/useManualAssetMutations";
import { calendarDay, dayString } from "@/lib/manual-assets/asset-view";
import { zLocaleNumber } from "@/lib/utils/number";

const FORM_ID = "manual-asset-valuation-form";

function buildSchema(
  t: (key: string) => string,
  locale: string,
  invalidAmount: string,
) {
  return z.object({
    value: zLocaleNumber(locale, invalidAmount).pipe(
      z.number().min(0, t("validation.negative")),
    ),
    date: z.string().min(1, t("validation.required")),
    note: z.string().max(2000).optional(),
  });
}

type FormInput = z.input<ReturnType<typeof buildSchema>>;
type FormValues = z.output<ReturnType<typeof buildSchema>>;

/**
 * "Update value": say what the asset is worth on a day. With `valuation` it
 * corrects that one instead. Neither creates a transaction.
 */
export default function ValuationDrawer({
  open,
  onOpenChange,
  asset,
  valuation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Pick<ManualAsset, "currency" | "manualAssetKey" | "value">;
  valuation?: ManualAssetValuation | null;
}) {
  const t = useTranslations("assets");
  const tCommon = useTranslations();
  const locale = useLocale();
  const saveMutation = useSaveValuation();

  const defaultValues = useMemo<FormInput>(
    () => ({
      value: valuation?.value ?? asset.value ?? "",
      date: valuation?.date ?? dayString(new Date()),
      note: valuation?.note ?? "",
    }),
    [asset.value, valuation],
  );
  const schema = useMemo(
    () => buildSchema(t, locale, tCommon("invalid-amount")),
    [t, tCommon, locale],
  );
  const form = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);

  const submit = async (values: FormValues) => {
    try {
      await saveMutation.mutateAsync({
        manualAssetId: asset.manualAssetKey,
        valuationId: valuation?.manualAssetValuationKey,
        payload: {
          value: values.value,
          date: values.date,
          note: values.note?.trim() ? values.note.trim() : null,
        },
      });
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
      title={valuation ? t("valuation.editTitle") : t("valuation.addTitle")}
      description={t("valuation.description")}
      footer={
        <Button form={FORM_ID} type="submit" loading={saveMutation.isPending}>
          {t("valuation.save")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent id={FORM_ID} onSubmit={form.handleSubmit(submit)}>
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("valuation.value")}</FormLabel>
                <FormControl>
                  <MoneyInput {...field} currency={asset.currency} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel required>{t("valuation.date")}</FormLabel>
                <DatePicker
                  form
                  inModal
                  disabled={{ after: new Date() }}
                  value={field.value ? calendarDay(field.value) : undefined}
                  onSelect={(date) => field.onChange(dayString(date))}
                  placeholder={t("fields.datePlaceholder")}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("valuation.note")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t("valuation.notePlaceholder")}
                  />
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
