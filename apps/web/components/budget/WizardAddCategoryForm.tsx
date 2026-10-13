"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import CategoryIconPicker from "@/components/settings/CategoryIconPicker";
import { Alert, AlertTitle } from "@/components/ui/Alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import useAddBudgetCategory from "@/lib/api/budget/useAddBudgetCategory";
import useCategories from "@/lib/api/category/useCategories";
import useCreateCategory from "@/lib/api/category/useCreateCategory";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { shouldAddCreatedCategoryToBudget } from "@/lib/utils/budget-wizard";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { zLocaleNumber } from "@/lib/utils/number";
import { invalidateCategories } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

const recurrencyOptions = [
  { value: "MONTHLY", label: "recurrency_monthly" },
  { value: "MONTHLY_14", label: "recurrency_monthly_14" },
  { value: "QUARTERLY", label: "recurrency_quarterly" },
  { value: "ANNUALLY", label: "recurrency_annually" },
  { value: "BI_ANNUALLY", label: "recurrency_biannually" },
];

const getCategoryFormSchema = (t: ReturnType<typeof useTranslations>) =>
  z
    .object({
      name: z.string().min(1, t("category-name-required")),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, t("invalid-color-format")),
      icon: z.string().optional(),
      parentCategoryKey: z.string().nullable(),
      budgetAmount: zLocaleNumber
        .pipe(z.number().min(0, t("budget-amount-positive")))
        .optional(),
      recurrency: z
        .enum(["MONTHLY", "MONTHLY_14", "QUARTERLY", "ANNUALLY", "BI_ANNUALLY"])
        .default("MONTHLY"),
    })
    .superRefine((data, ctx) => {
      if (
        data.budgetAmount &&
        data.budgetAmount > 0 &&
        !data.parentCategoryKey
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("parent-category-required-with-budget"),
          path: ["parentCategoryKey"],
        });
      }

      if (
        data.parentCategoryKey &&
        (!data.budgetAmount || data.budgetAmount <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("budget-amount-required-for-child-category"),
          path: ["budgetAmount"],
        });
      }
    });

type CategoryFormData = z.infer<ReturnType<typeof getCategoryFormSchema>>;

// Generate a random hex color
const generateRandomColor = (): string => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

interface WizardAddCategoryFormProps {
  budgetId: string;
}

const WizardAddCategoryForm: React.FC<WizardAddCategoryFormProps> = ({
  budgetId,
}) => {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const useCreateCategoryMutation = useCreateCategory();
  const useAddBudgetCategoryMutation = useAddBudgetCategory();
  const { data: categoriesResponse } = useCategories();
  const categories = categoriesResponse?.categories || [];
  const categoryFormSchema = getCategoryFormSchema(t);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const methods = useForm({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      color: generateRandomColor(),
      name: "",
      icon: "",
      parentCategoryKey: null,
      budgetAmount: 0,
      recurrency: "MONTHLY" as const,
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
    watch,
  } = methods;

  const parentCategoryKey = watch("parentCategoryKey");
  const isBudgetDisabled = !parentCategoryKey;

  const onSubmit = useCallback(
    async (data: CategoryFormData) => {
      try {
        // First create the category
        const createResponse = await useCreateCategoryMutation.mutateAsync({
          name: data.name,
          color: data.color,
          icon: data.icon,
          parentCategoryKey: data.parentCategoryKey || undefined,
        });

        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Add child categories with a positive budget to the current budget.
        // Parent categories are created for organization only and the API rejects
        // zero-budget template rows.
        const categoryKey = createResponse.data?.category.categoryKey;

        if (shouldAddCreatedCategoryToBudget(data)) {
          await useAddBudgetCategoryMutation.mutateAsync({
            budgetKey: Number(budgetId),
            categoryKey,
            amountBudgeted: data.budgetAmount!,
            recurrency: data.recurrency,
          });
        }

        toast.success(t("toast-create-category-success"));

        // Invalidate queries to refresh the budget table
        await Promise.all([
          invalidateCategories(queryClient),
          queryClient.invalidateQueries({
            queryKey: [
              "budget-template-year-month",
              Number(budgetId),
              currentMonth,
              currentYear,
            ],
          }),
        ]);

        // Reset form
        reset({
          color: generateRandomColor(),
          name: "",
          icon: "",
          parentCategoryKey: null,
          budgetAmount: 0,
          recurrency: "MONTHLY",
        });
      } catch (error) {
        if (isDemoReadOnlyError(error)) {
          toast.error(t("demo-read-only-title"), {
            description: t("demo-read-only-description"),
            duration: 9000,
          });
          return;
        }

        toast.error(t("toast-create-category-error"), {
          description: t("toast-create-category-error-description"),
        });
      }
    },
    [
      useCreateCategoryMutation,
      useAddBudgetCategoryMutation,
      queryClient,
      reset,
      t,
      budgetId,
    ],
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-info/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Plus className="text-info-text size-5" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg font-semibold">
                {t("budget-advanced-category-editing")}
              </CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("budget-advanced-category-editing-description")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant={isAdvancedOpen ? "secondary" : "outline"}
            aria-expanded={isAdvancedOpen}
            aria-controls="wizard-add-category-form"
            onClick={() => setIsAdvancedOpen((isOpen) => !isOpen)}
          >
            {isAdvancedOpen
              ? t("budget-hide-advanced-category-options")
              : t("budget-show-advanced-category-options")}
          </Button>
        </div>
      </CardHeader>

      {isAdvancedOpen && (
        <CardContent id="wizard-add-category-form">
          <Form {...methods}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Category Info */}
              <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_60px_60px_minmax(0,2fr)]">
                <FormField
                  control={methods.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold" required>
                        {t("name")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder={t("category-name-placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={methods.control}
                  name="color"
                  render={({ field: { onChange, value } }) => (
                    <FormItem>
                      <FormLabel className="font-semibold" required>
                        {t("color")}
                      </FormLabel>
                      <FormControl>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="input"
                              className="w-full justify-center p-2"
                              type="button"
                            >
                              <div
                                className="border-border size-6 rounded-lg border-2"
                                style={{ backgroundColor: value }}
                              />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64">
                            <HexColorPicker
                              color={value || ""}
                              onChange={onChange}
                            />
                            <div className="mt-2">
                              <Input
                                value={value || ""}
                                onChange={(e) => onChange(e.target.value)}
                                placeholder="#000000"
                                className="text-center"
                              />
                            </div>
                          </PopoverContent>
                        </Popover>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={methods.control}
                  name="icon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">
                        {t("icon")}
                      </FormLabel>
                      <FormControl>
                        <CategoryIconPicker
                          selectedIcon={field.value}
                          onIconSelect={field.onChange}
                          color={watch("color")}
                          compact
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={methods.control}
                  name="parentCategoryKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">
                        {t("parent-category")}
                      </FormLabel>
                      <Select
                        value={field.value ?? "none"}
                        onValueChange={(value) => {
                          const parentCategoryKey =
                            value === "none" ? null : value;
                          field.onChange(parentCategoryKey);

                          if (!parentCategoryKey) {
                            methods.setValue("budgetAmount", 0, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            methods.setValue("recurrency", "MONTHLY", {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("none")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("none")}</SelectItem>
                          {categories.map((c) => (
                            <SelectItem
                              key={c.categoryKey}
                              value={c.categoryKey.toString()}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className="size-3 rounded-full"
                                  style={{ backgroundColor: c.bgColor }}
                                />
                                {c.isSystemCategory
                                  ? t(getCategoryTranslationKey(c.name))
                                  : c.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Budget Information Section */}
              {isBudgetDisabled && (
                <Alert variant="warning">
                  <Info className="size-4" />
                  <AlertTitle className="mb-2">
                    {t("budget-only-for-child-categories")}
                  </AlertTitle>
                  <p className="text-muted-foreground text-sm">
                    {t("select-parent-category-to-enable-budget")}
                  </p>
                </Alert>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={methods.control}
                  name="budgetAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">
                        {t("budget-amount")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="0"
                          min="0"
                          step="0.01"
                          disabled={isBudgetDisabled}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={methods.control}
                  name="recurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">
                        {t("recurrence")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isBudgetDisabled}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("recurrence")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {recurrencyOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={isSubmitting}
                >
                  {t("create-category")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      )}
    </Card>
  );
};

export default WizardAddCategoryForm;
