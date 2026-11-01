"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import DatePicker from "@/components/ui/DatePicker";
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
import { Textarea } from "@/components/ui/textarea";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type { Goal, UpdateGoalRequest } from "@/lib/api/goals/types";
import useUpdateGoal from "@/lib/api/goals/useUpdateGoal";
import type { GoalPriority } from "@/lib/goals/form";
import {
  formatGoalDateInput,
  GOAL_PRIORITY_OPTIONS,
  parseGoalDateInput,
  parseGoalMoney,
} from "@/lib/goals/form";
import { cn } from "@/lib/utils";

type GoalEditDialogProps = {
  readonly goal: Goal;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

type FormValues = {
  readonly currentBalance: string;
  readonly description: string;
  readonly extraPayment: string;
  readonly interestRate: string;
  readonly minimumPayment: string;
  readonly monthlyContributionTarget: string;
  readonly name: string;
  readonly priority: GoalPriority;
  readonly targetAmount: string;
  readonly targetDate: string;
};

function toDateInputValue(value: Date | null | string | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function buildDefaults(goal: Goal): FormValues {
  return {
    currentBalance: String(goal.currentBalance ?? ""),
    description: goal.description ?? "",
    extraPayment: String(goal.extraPayment ?? ""),
    interestRate:
      goal.annualInterestRateBps != null
        ? String(goal.annualInterestRateBps / 100)
        : "",
    minimumPayment: String(goal.minimumPayment ?? ""),
    monthlyContributionTarget: String(goal.monthlyContributionTarget ?? ""),
    name: goal.name,
    priority: Math.min(2, Math.max(0, goal.priority ?? 0)) as GoalPriority,
    targetAmount: String(goal.targetAmount),
    targetDate: toDateInputValue(goal.targetDate),
  };
}

export default function GoalEditDialog({
  goal,
  isOpen,
  onOpenChange,
}: GoalEditDialogProps) {
  const t = useTranslations();
  const mutation = useUpdateGoal(goal.goalKey);
  const isDebt = goal.type === "debt_paydown";
  const currencyCode =
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" ? goal.currencyKey?.code : undefined);
  const tomorrowIso = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }, []);
  const existingTargetDate = toDateInputValue(goal.targetDate);
  const minimumTargetDate =
    existingTargetDate && existingTargetDate < tomorrowIso
      ? existingTargetDate
      : tomorrowIso;

  const schema = z
    .object({
      currentBalance: z.string(),
      description: z.string().max(500, t("invalid-description")),
      extraPayment: z.string(),
      interestRate: z.string(),
      minimumPayment: z.string(),
      monthlyContributionTarget: z
        .string()
        .refine(
          (value) => !value.trim() || parseGoalMoney(value) > 0,
          t("invalid-amount"),
        ),
      name: z.string().min(1, t("invalid-name")),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      targetAmount: z.string(),
      targetDate: z
        .string()
        .refine(
          (value) => !value || value >= minimumTargetDate,
          t("invalid-date"),
        ),
    })
    .superRefine((values, ctx) => {
      if (isDebt) {
        if (parseGoalMoney(values.currentBalance) <= 0)
          ctx.addIssue({
            code: "custom",
            message: t("invalid-amount"),
            path: ["currentBalance"],
          });
        const rate = Number(values.interestRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1000)
          ctx.addIssue({
            code: "custom",
            message: t("goals.debt-interest-invalid"),
            path: ["interestRate"],
          });
        if (parseGoalMoney(values.minimumPayment) <= 0)
          ctx.addIssue({
            code: "custom",
            message: t("invalid-amount"),
            path: ["minimumPayment"],
          });
      } else if (parseGoalMoney(values.targetAmount) <= 0) {
        ctx.addIssue({
          code: "custom",
          message: t("invalid-amount"),
          path: ["targetAmount"],
        });
      }
    });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(goal),
  });

  useEffect(() => {
    if (!isOpen) return;
    form.reset(buildDefaults(goal));
  }, [form, goal, isOpen]);

  const priority = useWatch({ control: form.control, name: "priority" });

  const setPriority = (next: GoalPriority) => {
    form.setValue("priority", next, {
      shouldValidate: form.formState.isSubmitted,
    });
    form.clearErrors();
  };

  const onSubmit = async (values: FormValues) => {
    const body: UpdateGoalRequest = isDebt
      ? {
          annualInterestRatePercent: Number(values.interestRate),
          currentBalance: parseGoalMoney(values.currentBalance),
          description: values.description.trim() || null,
          extraPayment: values.extraPayment.trim()
            ? parseGoalMoney(values.extraPayment)
            : 0,
          minimumPayment: parseGoalMoney(values.minimumPayment),
          name: values.name.trim(),
          priority: values.priority,
          targetDate: values.targetDate || null,
        }
      : {
          description: values.description.trim() || null,
          monthlyContributionTarget: values.monthlyContributionTarget.trim()
            ? parseGoalMoney(values.monthlyContributionTarget)
            : null,
          name: values.name.trim(),
          priority: values.priority,
          targetAmount: parseGoalMoney(values.targetAmount),
          targetDate: values.targetDate || null,
        };

    try {
      await mutation.mutateAsync(body);
      toast.success(t("goals.edit-success"));
      onOpenChange(false);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("goals.edit-error"));
    }
  };

  const moneyLabel = (key: string) =>
    currencyCode ? `${t(key)} (${currencyCode})` : t(key);

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("goals.edit-title")}
    >
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("goals.name")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("goals.priority-label")}
            </legend>
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label={t("goals.priority-label")}
            >
              {GOAL_PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === option.value}
                  onClick={() => setPriority(option.value)}
                  className={cn(
                    "focus-visible:ring-ring rounded-lg border p-3 text-left transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2",
                    priority === option.value
                      ? "border-primary ring-primary bg-primary/5 ring-1"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="text-foreground block text-sm font-medium">
                    {t(option.labelKey)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {isDebt ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currentBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {moneyLabel("goals.debt-current-balance")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" type="tel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="interestRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t("goals.debt-interest-rate")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" type="tel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minimumPayment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {moneyLabel("goals.debt-minimum-payment")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" type="tel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="extraPayment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {moneyLabel("goals.debt-extra-payment")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" type="tel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </>
          ) : (
            <FormField
              control={form.control}
              name="targetAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("goals.target-amount")}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" type="tel" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="targetDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    {isDebt
                      ? t("goals.debt-target-date")
                      : t("goals.target-date")}
                  </FormLabel>
                  <DatePicker
                    form
                    inModal
                    value={parseGoalDateInput(field.value)}
                    onSelect={(date) => field.onChange(formatGoalDateInput(date))}
                    disabled={{ before: parseGoalDateInput(minimumTargetDate) as Date }}
                    placeholder={t("goals.target-date")}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isDebt && (
              <FormField
                control={form.control}
                name="monthlyContributionTarget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("goals.monthly-contribution")}</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" type="tel" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("goals.description")}</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || mutation.isPending}
              loading={form.formState.isSubmitting || mutation.isPending}
            >
              {t("save")}
            </Button>
          </div>
        </form>
      </Form>
    </DrawerDialog>
  );
}
