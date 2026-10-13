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
import useAssignGoalMoney from "@/lib/api/goals/useAssignGoalMoney";
import useAvailableToAssign from "@/lib/api/goals/useAvailableToAssign";
import { formatGoalCurrency } from "@/lib/goals/format";

import { Input } from "../ui/input";

const schema = z.object({
  amount: z.coerce.number(),
});

type FormValues = z.infer<typeof schema>;

export default function AssignMoneyDialog({
  goalKey,
  isOpen,
  onOpenChange,
  currencyCode,
}: {
  goalKey: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currencyCode?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const mutation = useAssignGoalMoney(goalKey);
  const availableQuery = useAvailableToAssign({ enabled: isOpen });
  const availableToAssign = availableQuery.data?.availableToAssign ?? 0;
  const amountSchema = z.coerce
    .number()
    .gt(0, { message: t("goals.amount-must-be-positive") })
    .max(availableToAssign, {
      message: t("goals.assign-money-insufficient", {
        amount: formatGoalCurrency(availableToAssign, currencyCode, locale),
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
        {
          onSuccess: () => {
            toast.success(t("goals.assign-money-success"));
            onOpenChange(false);
          },
        },
      );
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }

      toast.error(t("server-error"));
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("goals.assign-money-title")}
    >
      <Form {...form}>
        <form
          id="assign-goal-money-form"
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
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                  />
                </FormControl>
                <p className="text-muted-foreground text-sm">
                  {t("goals.available-to-assign")}:{" "}
                  {availableQuery.isLoading
                    ? "—"
                    : formatGoalCurrency(availableToAssign, currencyCode, locale)}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={form.formState.isSubmitting || mutation.isPending}
              disabled={
                form.formState.isSubmitting ||
                mutation.isPending ||
                availableQuery.isLoading
              }
            >
              {t("submit")}
            </Button>
          </div>
        </form>
      </Form>
    </DrawerDialog>
  );
}
