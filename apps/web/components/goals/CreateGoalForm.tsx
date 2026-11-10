"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import DatePicker from "@/components/ui/DatePicker";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Textarea } from "@/components/ui/textarea";
import useAccounts from "@/lib/api/account/useAccounts";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type { CreateGoalRequest, GoalType } from "@/lib/api/goals/types";
import useCreateGoal from "@/lib/api/goals/useCreateGoal";
import useLoans from "@/lib/api/loan/useLoans";
import type { GoalPriority } from "@/lib/goals/form";
import {
  formatGoalDateInput,
  GOAL_PRIORITY_OPTIONS,
  parseGoalDateInput,
  parseGoalMoney,
} from "@/lib/goals/form";
import { cn } from "@/lib/utils";
import { formatLocaleNumberInput } from "@/lib/utils/number";

import {
  GOAL_OPTION_TILE_CLASS,
  GOAL_PRIORITY_TILE_CLASS,
} from "./goal-option-tiles";

interface FormValues {
  loanKey?: string;
  currentBalance?: string;
  description: string;
  extraPayment?: string;
  interestRate?: string;
  minimumPayment?: string;
  monthlyContributionTarget?: string;
  name: string;
  priority: GoalPriority;
  targetAmount?: string;
  targetDate?: string;
  type: GoalType;
}

interface CreateGoalFormProps {
  formId?: string;
  onSuccess?: (goalKey?: number | string) => void;
}

const GOAL_TYPES: GoalType[] = ["save_up", "debt_paydown"];

export default function CreateGoalForm({
  formId = "create-goal-form",
  onSuccess,
}: CreateGoalFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const posthog = usePostHog();
  const createGoal = useCreateGoal();
  const { data: accountsData } = useAccounts();
  const { data: loansData } = useLoans();
  const currencyCode =
    accountsData?.accounts[0]?.accountOwnerAppuserKey.currencyKey.code;
  const loans = loansData?.loans ?? [];
  const tomorrowIso = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  }, []);

  const locale = useLocale();
  const money = (value: string) => parseGoalMoney(value, locale);
  const positiveMoney = (value?: string) => !value?.trim() || money(value) > 0;

  const schema = z
    .object({
      loanKey: z.string().optional(),
      currentBalance: z.string().optional(),
      description: z.string().max(500, t("invalid-description")),
      extraPayment: z
        .string()
        .optional()
        .refine(
          (value) => !value?.trim() || money(value) >= 0,
          t("goals.amount-must-be-positive"),
        ),
      interestRate: z.string().optional(),
      minimumPayment: z.string().optional(),
      monthlyContributionTarget: z
        .string()
        .optional()
        .refine(positiveMoney, t("goals.amount-must-be-positive")),
      name: z.string().trim().min(1, t("goals.name-required")),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      targetAmount: z.string().optional(),
      targetDate: z
        .string()
        .optional()
        .refine((value) => !value || value >= tomorrowIso, t("invalid-date")),
      type: z.enum(["save_up", "debt_paydown"]),
    })
    .superRefine((values, ctx) => {
      if (values.type === "debt_paydown") {
        // `!(x > 0)` rather than `x <= 0`: an unreadable figure is NaN and
        // must fail too.
        if (!values.currentBalance || !(money(values.currentBalance) > 0))
          ctx.addIssue({
            code: "custom",
            message: t("goals.amount-must-be-positive"),
            path: ["currentBalance"],
          });
        const rate = money(values.interestRate ?? "");
        if (
          !values.interestRate?.trim() ||
          !Number.isFinite(rate) ||
          rate < 0 ||
          rate > 1000
        )
          ctx.addIssue({
            code: "custom",
            message: t("goals.debt-interest-invalid"),
            path: ["interestRate"],
          });
        if (!values.minimumPayment || !(money(values.minimumPayment) > 0))
          ctx.addIssue({
            code: "custom",
            message: t("goals.amount-must-be-positive"),
            path: ["minimumPayment"],
          });
      } else if (!values.targetAmount || !(money(values.targetAmount) > 0)) {
        ctx.addIssue({
          code: "custom",
          message: t("goals.amount-must-be-positive"),
          path: ["targetAmount"],
        });
      }
    });

  const form = useForm<FormValues>({
    defaultValues: {
      loanKey: "",
      currentBalance: "",
      description: "",
      extraPayment: "",
      interestRate: "",
      minimumPayment: "",
      monthlyContributionTarget: "",
      name: "",
      priority: 0,
      targetAmount: "",
      targetDate: "",
      type: "save_up",
    },
    resolver: zodResolver(schema),
  });

  const goalType = useWatch({ control: form.control, name: "type" });
  const isDebt = goalType === "debt_paydown";

  const setGoalType = (next: GoalType) => {
    form.setValue("type", next, { shouldValidate: form.formState.isSubmitted });
    form.clearErrors();
  };

  const priority = useWatch({ control: form.control, name: "priority" });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const setPriority = (next: GoalPriority) => {
    form.setValue("priority", next, {
      shouldValidate: form.formState.isSubmitted,
    });
    form.clearErrors();
  };

  const prefillFromFacility = (loanKey: string) => {
    form.setValue("loanKey", loanKey);
    const facility = loans.find((loan) => String(loan.loanKey) === loanKey);
    if (!facility) return;
    if (!form.getValues("name")) form.setValue("name", facility.name);
    // In the reader's number format, so the prefilled figure reads back as is.
    const show = (value: number | null | undefined) =>
      formatLocaleNumberInput(value, locale);
    form.setValue("currentBalance", show(facility.outstandingPrincipal));
    if (facility.annualInterestRateBps != null)
      form.setValue("interestRate", show(facility.annualInterestRateBps / 100));
    if (facility.regularPaymentAmount != null)
      form.setValue("minimumPayment", show(facility.regularPaymentAmount));
  };

  const onSubmit = async (values: FormValues) => {
    const debt = values.type === "debt_paydown";
    const monthlyContributionTarget =
      values.monthlyContributionTarget?.trim() ?? "";

    const body: CreateGoalRequest = debt
      ? {
          annualInterestRatePercent: money(values.interestRate ?? ""),
          loanKey: values.loanKey ? Number(values.loanKey) : undefined,
          currentBalance: money(values.currentBalance ?? ""),
          description: values.description || undefined,
          extraPayment: values.extraPayment?.trim()
            ? money(values.extraPayment)
            : undefined,
          minimumPayment: money(values.minimumPayment ?? ""),
          name: values.name,
          priority: values.priority,
          targetDate: values.targetDate || undefined,
          type: "debt_paydown",
        }
      : {
          description: values.description || undefined,
          monthlyContributionTarget: monthlyContributionTarget
            ? money(monthlyContributionTarget)
            : undefined,
          name: values.name,
          priority: values.priority,
          targetAmount: money(values.targetAmount ?? ""),
          targetDate: values.targetDate || undefined,
          type: "save_up",
        };

    try {
      const response = await createGoal.mutateAsync(body);
      const goalKey = response.data?.goal?.goalKey;
      posthog.capture("goal_created", {
        currency: currencyCode,
        goal_key: goalKey,
        goal_type: values.type,
        has_target_date: Boolean(values.targetDate),
      });
      form.reset();
      toast.success(t("goals.create-success"));
      if (onSuccess) onSuccess(goalKey);
      else router.push(goalKey ? `/goals/${goalKey}` : "/goals");
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
    <Form {...form}>
      <form
        id={formId}
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t("goals.type-label")}
          </legend>
          <div
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("goals.type-label")}
          >
            {GOAL_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={goalType === option}
                onClick={() => setGoalType(option)}
                className={GOAL_OPTION_TILE_CLASS}
              >
                <span className="text-foreground block text-sm font-medium">
                  {t(`goals.type-${option}`)}
                </span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {t(`goals.type-${option}-hint`)}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

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

        {isDebt && loans.length > 0 && (
          <FormField
            control={form.control}
            name="loanKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("goals.debt-link-facility")}</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={prefillFromFacility}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("goals.debt-link-facility-placeholder")}
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {loans.map((loan) => (
                      <SelectItem
                        key={loan.loanKey}
                        value={String(loan.loanKey)}
                      >
                        {loan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("goals.name")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  required
                  placeholder={
                    isDebt
                      ? t("goals.debt-name-placeholder")
                      : t("goals.name-placeholder")
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                        required
                        type="tel"
                        placeholder={t(
                          "goals.debt-current-balance-placeholder",
                        )}
                        currency={currencyCode}
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
                        required
                        type="tel"
                        inputMode="decimal"
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
                        required
                        type="tel"
                        placeholder={t(
                          "goals.debt-minimum-payment-placeholder",
                        )}
                        currency={currencyCode}
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
                        placeholder={t("goals.debt-extra-payment-placeholder")}
                        currency={currencyCode}
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
                  <MoneyInput
                    {...field}
                    required
                    type="tel"
                    currency={currencyCode}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="targetDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>
                {isDebt ? t("goals.debt-target-date") : t("goals.target-date")}
              </FormLabel>
              <DatePicker
                form
                inModal
                value={parseGoalDateInput(field.value)}
                onSelect={(date) => field.onChange(formatGoalDateInput(date))}
                disabled={{ before: parseGoalDateInput(tomorrowIso) as Date }}
                placeholder={t("goals.target-date-placeholder")}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {!isDebt && (
          <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
              >
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform motion-reduce:transition-none",
                    isAdvancedOpen && "rotate-90",
                  )}
                  aria-hidden="true"
                />
                {t("goals.advanced-options")}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-6">
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
            </CollapsibleContent>
          </Collapsible>
        )}

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

        {createGoal.isError && (
          <p className="text-destructive-text text-sm" role="alert">
            {createGoal.error.message}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            loading={createGoal.isPending || form.formState.isSubmitting}
            disabled={createGoal.isPending || form.formState.isSubmitting}
          >
            {t("goals.create")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
