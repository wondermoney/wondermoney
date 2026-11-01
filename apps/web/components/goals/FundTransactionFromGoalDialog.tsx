"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Link } from "@/components/ui/Link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import useFundGoalTransaction from "@/lib/api/goals/useFundGoalTransaction";
import useGoals from "@/lib/api/goals/useGoals";
import { formatGoalCurrency } from "@/lib/goals/format";

type FormValues = {
  goalKey: string;
  amount: string;
};

export default function FundTransactionFromGoalDialog({
  currencyCode,
  isOpen,
  maxAmount,
  onOpenChange,
  transactionKey,
}: {
  currencyCode?: string;
  isOpen: boolean;
  maxAmount: number;
  onOpenChange: (open: boolean) => void;
  transactionKey: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { data } = useGoals(undefined, { enabled: isOpen });
  const goals = useMemo(() => data?.goals ?? [], [data?.goals]);
  const defaultGoalKey = useMemo(
    () =>
      goals.find((goal) => goal.status === "active")?.goalKey ??
      goals[0]?.goalKey,
    [goals],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(
      z.object({
        goalKey: z.string().min(1, t("goals.fund-transaction-goal-required")),
        amount: z
          .string()
          .refine(
            (value) => Number(value) > 0,
            t("goals.fund-transaction-amount-positive"),
          )
          .refine(
            (value) => Number(value) <= maxAmount,
            t("goals.fund-transaction-amount-max", { amount: maxAmount }),
          ),
      }),
    ),
    defaultValues: {
      goalKey: "",
      amount: "",
    },
  });

  const watchedGoalKey = useWatch({ control: form.control, name: "goalKey" });
  const selectedGoalKey = Number(watchedGoalKey || defaultGoalKey || 0);
  const mutation = useFundGoalTransaction(selectedGoalKey);
  const formattedMax = formatGoalCurrency(maxAmount, currencyCode, locale);

  useEffect(() => {
    if (isOpen) {
      form.reset({
        goalKey: defaultGoalKey ? String(defaultGoalKey) : "",
        amount: "",
      });
    }
  }, [defaultGoalKey, form, isOpen]);

  const onSubmit = async (values: FormValues) => {
    try {
      await mutation.mutateAsync(
        { amount: Number(values.amount), transactionKey },
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

      toast.error(t("server-error"));
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("goals.fund-transaction-title")}
    >
      <Form {...form}>
        <form
          className="w-full space-y-4"
          id="fund-goal-transaction-form"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {goals.length === 0 && (
            <div className="bg-muted/30 text-muted-foreground rounded-md border p-4 text-sm">
              <p>{t("goals.fund-transaction-no-goals")}</p>
              <Link
                href="/goals"
                className="text-foreground mt-2 inline-flex font-medium underline-offset-4 hover:underline"
              >
                {t("goals.create")}
              </Link>
            </div>
          )}
          <FormField
            control={form.control}
            name="goalKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("goals.goal")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("goals.goal-placeholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {goals.map((goal) => (
                      <SelectItem
                        key={goal.goalKey}
                        value={String(goal.goalKey)}
                      >
                        {goal.name}
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
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("amount")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className="font-mono tabular-nums"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    type="number"
                  />
                </FormControl>
                <p className="text-muted-foreground text-xs">
                  {t("goals.fund-transaction-max", { amount: formattedMax })}
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
                goals.length === 0
              }
            >
              {t("goals.fund-transaction-submit")}
            </Button>
          </div>
        </form>
      </Form>
    </DrawerDialog>
  );
}
