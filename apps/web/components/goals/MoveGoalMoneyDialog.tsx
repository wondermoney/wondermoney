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
import { formatGoalCurrency } from "@/lib/goals/format";

import { Input } from "../ui/input";

const schema = z.object({
  amount: z.coerce.number<number>(),
});

type FormValues = z.infer<typeof schema>;

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
  const mutation = useMoveGoalMoneyOut(goalKey);
  const amountSchema = z.coerce
    .number<number>()
    .gt(0, { message: t("goals.amount-must-be-positive") })
    .max(availableAmount, {
      message: t("goals.move-money-insufficient", {
        amount: formatGoalCurrency(availableAmount, currencyCode, locale),
      }),
    });
  const form = useForm<FormValues>({
    resolver: zodResolver(schema.extend({ amount: amountSchema })),
    defaultValues: { amount: 0 },
  });

  useEffect(() => {
    if (isOpen) form.reset({ amount: 0 });
  }, [form, isOpen]);

  const onSubmit = async (values: FormValues) => {
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
                    type="number"
                    min="0"
                    step="0.01"
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
