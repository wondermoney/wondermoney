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
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
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
import { formatLocaleNumberInput } from "@/lib/utils/number";

import { GOAL_PRIORITY_TILE_CLASS } from "./goal-option-tiles";

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

// Stored figures are shown with the reader's decimal separator, so editing one
// and reading it back with parseGoalMoney gives the same number.
function buildDefaults(goal: Goal, locale: string): FormValues {
  const show = (value: number | null | undefined) =>
    formatLocaleNumberInput(value, locale);
  return {
    currentBalance: show(goal.currentBalance),
    description: goal.description ?? "",
    extraPayment: show(goal.extraPayment),
    interestRate:
      goal.annualInterestRateBps != null
        ? show(goal.annualInterestRateBps / 100)
        : "",
    minimumPayment: show(goal.minimumPayment),
    monthlyContributionTarget: show(goal.monthlyContributionTarget),
    name: goal.name,
    priority: Math.min(2, Math.max(0, goal.priority ?? 0)) as GoalPriority,
    targetAmount: show(goal.targetAmount),
    targetDate: toDateInputValue(goal.targetDate),
  };
}

export default function GoalEditDialog({
  goal,
  isOpen,
  onOpenChange,
}: GoalEditDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (value: string) => parseGoalMoney(value, locale);
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
          (value) => !value.trim() || money(value) > 0,
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
        // `!(x > 0)` rather than `x <= 0`: an unreadable figure is NaN and
        // must fail too.
        if (!(money(values.currentBalance) > 0))
          ctx.addIssue({
            code: "custom",
            message: t("invalid-amount"),
            path: ["currentBalance"],
          });
        const rate = money(values.interestRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1000)
          ctx.addIssue({
            code: "custom",
            message: t("goals.debt-interest-invalid"),
            path: ["interestRate"],
          });
        if (!(money(values.minimumPayment) > 0))
          ctx.addIssue({
            code: "custom",
            message: t("invalid-amount"),
            path: ["minimumPayment"],
          });
        if (values.extraPayment.trim() && !(money(values.extraPayment) >= 0))
          ctx.addIssue({
            code: "custom",
            message: t("invalid-amount"),
            path: ["extraPayment"],
          });
      } else if (!(money(values.targetAmount) > 0)) {
        ctx.addIssue({
          code: "custom",
          message: t("invalid-amount"),
          path: ["targetAmount"],
        });
      }
    });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(goal, locale),
  });

  useEffect(() => {
    if (!isOpen) return;
    form.reset(buildDefaults(goal, locale));
  }, [form, goal, isOpen, locale]);

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
          annualInterestRatePercent: money(values.interestRate),
          currentBalance: money(values.currentBalance),
          description: values.description.trim() || null,
          extraPayment: values.extraPayment.trim()
            ? money(values.extraPayment)
            : 0,
          minimumPayment: money(values.minimumPayment),
          name: values.name.trim(),
          priority: values.priority,
          targetDate: values.targetDate || null,
        }
      : {
          description: values.description.trim() || null,
          monthlyContributionTarget: values.monthlyContributionTarget.trim()
            ? money(values.monthlyContributionTarget)
            : null,
          name: values.name.trim(),
          priority: values.priority,
          targetAmount: money(values.targetAmount),
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

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("goals.edit-title")}
    >
      <Form {...form}>
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("goals.name")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t(
                      isDebt
                        ? "goals.debt-name-placeholder"
                        : "goals.name-placeholder",
                    )}
                  />
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
                  className={GOAL_PRIORITY_TILE_CLASS}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </fieldset>

          {isDebt ? (
            <>
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="currentBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t("goals.debt-current-balance")}
                      </FormLabel>
                      <FormControl>
                        <MoneyInput
                          {...field}
                          type="tel"
                          currency={currencyCode}
                          placeholder={t(
                            "goals.debt-current-balance-placeholder",
                          )}
                        />
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
                        <Input
                          {...field}
                          inputMode="decimal"
                          type="tel"
                          placeholder="19.99"
                          className="text-right font-mono"
                          endAdornment={<span className="font-mono">%</span>}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="minimumPayment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t("goals.debt-minimum-payment")}
                      </FormLabel>
                      <FormControl>
                        <MoneyInput
                          {...field}
                          type="tel"
                          currency={currencyCode}
                          placeholder={t(
                            "goals.debt-minimum-payment-placeholder",
                          )}
                        />
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
                      <FormLabel>{t("goals.debt-extra-payment")}</FormLabel>
                      <FormControl>
                        <MoneyInput
                          {...field}
                          type="tel"
                          currency={currencyCode}
                          placeholder={t(
                            "goals.debt-extra-payment-placeholder",
                          )}
                        />
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
                    <MoneyInput {...field} type="tel" currency={currencyCode} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="space-y-6">
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
                    onSelect={(date) =>
                      field.onChange(formatGoalDateInput(date))
                    }
                    disabled={{
                      before: parseGoalDateInput(minimumTargetDate) as Date,
                    }}
                    placeholder={t("goals.target-date-placeholder")}
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
                      <MoneyInput
                        {...field}
                        type="tel"
                        currency={currencyCode}
                      />
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
                  <Textarea
                    {...field}
                    placeholder={t("goals.description-placeholder")}
                  />
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
