"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import useMoveGoalMoneyOut from "@/lib/api/goals/useMoveGoalMoneyOut";
import { useFormatGoalCurrency } from "@/lib/goals/useFormatGoalCurrency";
import { zLocaleNumber } from "@/lib/utils/number";

import { Input } from "../ui/input";

type FormValues = { amount: string | number };

export default function MoveGoalMoneyDialog({
  goalKey,
  isOpen,
  onOpenChange,
  availableAmount,
  currencyCode,
}: {
  goalKey: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  availableAmount: number;
  currencyCode?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formatGoalCurrency = useFormatGoalCurrency();
  const mutation = useMoveGoalMoneyOut(goalKey);
  // Typed in the user's locale ("1.234,56" for pt and es); unreadable input is
  // an error, never another number.
  const amountSchema = zLocaleNumber(locale, t("invalid-amount")).pipe(
    z
      .number()
      .gt(0, { message: t("goals.amount-must-be-positive") })
      .max(availableAmount, {
        message: t("goals.move-money-insufficient", {
          amount: formatGoalCurrency(availableAmount, currencyCode, locale),
        }),
      }),
  );
  const form = useForm<FormValues, undefined, { amount: number }>({
    resolver: zodResolver(z.object({ amount: amountSchema })),
    defaultValues: { amount: "" },
  });

  useEffect(() => {
    if (isOpen) form.reset({ amount: "" });
  }, [form, isOpen]);

  const onSubmit = async (values: { amount: number }) => {
    try {
      await mutation.mutateAsync(
        { amount: values.amount },
        { onSuccess: () => onOpenChange(false) },
      );
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }

      toast.error(t("goals.move-money-error"));
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("goals.move-money-out-title")}
    >
      <Form {...form}>
        <form
          id="move-goal-money-form"
          className="w-full space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("goals.amount")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="font-mono tabular-nums"
                    inputMode="decimal"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={form.formState.isSubmitting || mutation.isPending}
              disabled={form.formState.isSubmitting || mutation.isPending}
            >
              {t("submit")}
            </Button>
          </div>
        </form>
      </Form>
    </DrawerDialog>
  );
}
