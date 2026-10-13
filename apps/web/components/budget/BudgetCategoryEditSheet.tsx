"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Edit2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Amount } from "@/components/ui/Amount";
import Text from "@/components/ui/Typography/Text";
import useEditBudgetCategory from "@/lib/api/budget/useEditBudgetCategory";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";
import { parseLocaleNumber, zLocaleNumber } from "@/lib/utils/number";
import {
  convertMonthlyAmountToAnuallizedMonthlyAmount,
  convertRecurrencyIntoMonthsInYear,
  convertRecurrencyMonthsIntoString,
  Recurrency,
} from "@/lib/utils/recurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/Form";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { BudgetRow } from "./BudgetTable";

const recurrencyOptions = [
  { value: "MONTHLY", label: "recurrency_monthly" },
  { value: "MONTHLY_14", label: "recurrency_monthly_14" },
  { value: "QUARTERLY", label: "recurrency_quarterly" },
  { value: "ANNUALLY", label: "recurrency_annually" },
  { value: "BI_ANNUALLY", label: "recurrency_biannually" },
];

type Props = {
  budgetKey: number;
  year: number;
  month: number;
  category: BudgetRow;
  currency: SupportedCurrencyCodes;
};

const createFormSchema = (t: ReturnType<typeof useTranslations>) =>
  z.object({
    budgeted: zLocaleNumber.pipe(
      z.number().positive(t("budget-amount-positive")),
    ),
    recurrency: z.nativeEnum(Recurrency).optional(),
    applyToFollowingMonths: z.boolean().optional().default(true),
  });

type FormSchema = z.infer<ReturnType<typeof createFormSchema>>;

export function BudgetCategoryEditSheet({
  budgetKey,
  year,
  month,
  category,
  currency,
}: Props) {
  const t = useTranslations();
  const posthog = usePostHog();
  const formSchema = createFormSchema(t);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      // The API can return a monthly amount derived from an annual/quarterly
      // recurrency (e.g. 7000 / 12 = 583.3333...) — round to cents so the
      // input doesn't show more precision than every other amount field in
      // the app displays.
      budgeted: Math.round(category.budgeted * 100) / 100,
      recurrency: category.recurrency
        ? convertRecurrencyMonthsIntoString(category.recurrency)
        : Recurrency.MONTHLY,
    },
  });
  const {
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = form;

  const [isOpen, setIsOpen] = useState(false);

  const recurrency = form.watch("recurrency");

  const editBudgetCategoryMutation = useEditBudgetCategory();
  const queryClient = useQueryClient();
  const formatCurrency = useFormatCurrency();

  const onSubmit: SubmitHandler<FormSchema> = async (values) => {
    try {
      await editBudgetCategoryMutation.mutateAsync({
        categoryKey: category.key,
        budgetKey,
        year,
        month,
        amount: values.budgeted,
        recurrency: values.recurrency,
        applyToFollowingMonths: values.applyToFollowingMonths,
      });
      posthog.capture("budget_category_edited", {
        budget_key: budgetKey,
        category_key: category.key,
        recurrency: values.recurrency,
        apply_to_following_months: Boolean(values.applyToFollowingMonths),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["budget-template-year-month", budgetKey, month, year],
        }),
        queryClient.invalidateQueries({
          queryKey: ["budget-template-year", budgetKey, year],
        }),
      ]);
      reset();
      setIsOpen(false);
      toast.success(t("budget-category-updated"));
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
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <DropdownMenuItem
          className="flex w-full flex-row justify-between"
          onSelect={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {t("edit")}
          <Edit2 className="text-foreground size-4" />
        </DropdownMenuItem>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("edit-budget-category")}</SheetTitle>
          <SheetDescription>
            {t("edit-budget-category-description")}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="mt-8 w-full space-y-6"
            onSubmit={handleSubmit(onSubmit)}
            id="edit-budget-category-form"
          >
            <FormField
              control={form.control}
              name="recurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("recurrence-question")}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={t("recurrence")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {recurrencyOptions.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {t(r.label)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="budgeted"
              defaultValue={category.budgeted}
              render={({ field }) => {
                const budgetedPreviewValue =
                  typeof field.value === "number"
                    ? field.value
                    : parseLocaleNumber(field.value);

                return (
                  <FormItem>
                    <FormLabel>{t("amount")}</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder={t("amount")}
                        startAdornment={
                          <Text variant="mutedText" className="px-4">
                            €
                          </Text>
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("total-yearly-value")}:{" "}
                      <Amount
                        value={
                          budgetedPreviewValue *
                          (recurrency
                            ? convertRecurrencyIntoMonthsInYear(recurrency)
                            : 12)
                        }
                        currency={currency}
                      />{" "}
                      ({t("value-x-recurrence")})
                    </FormDescription>
                    <FormDescription>
                      {t("monthly-value-annualized")}:{" "}
                      <Amount
                        value={convertMonthlyAmountToAnuallizedMonthlyAmount(
                          budgetedPreviewValue,
                          recurrency
                            ? convertRecurrencyIntoMonthsInYear(recurrency)
                            : 12,
                        )}
                        currency={currency}
                      />
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="applyToFollowingMonths"
              rules={{ required: t("invalid-file-required") }}
              render={({ field }) => (
                <FormItem>
                  <div className="align-center flex flex-row gap-3 pb-4">
                    <FormControl>
                      <Checkbox
                        id="apply-to-following-months"
                        defaultChecked={true}
                        checked={field.value}
                        onCheckedChange={(value: boolean) =>
                          form.setValue(field.name, value)
                        }
                      />
                    </FormControl>
                    <Label htmlFor="apply-to-following-months">
                      {t("apply-change-months")}
                    </Label>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            form="edit-budget-category-form"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
