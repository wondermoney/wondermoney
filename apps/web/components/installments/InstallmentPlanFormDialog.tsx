"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import CategorySelect from "@/components/CategorySelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { Category } from "@/lib/api/category/useCategories";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  InstallmentLink,
  InstallmentPlan,
  InstallmentPlanDetail,
} from "@/lib/api/installment-plans/types";
import {
  useCreateInstallmentPlan,
  useUpdateInstallmentPlan,
} from "@/lib/api/installment-plans/useInstallmentPlanMutations";
import {
  installmentPreview,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
} from "@/lib/installments/installment-amounts";
import {
  formatLocaleNumberInput,
  parseAmountInput,
  zLocaleNumber,
} from "@/lib/utils/number";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

/** What a new plan's form starts with: blank, or a detected suggestion's figures. */
export interface InstallmentPlanDraft {
  description?: string;
  purchaseDate?: string;
  totalAmount?: number;
  installmentCount?: number;
  categoryKey?: number | null;
  /** Posted card rows to link to their installments when the plan is created. */
  links?: InstallmentLink[];
}

export type InstallmentPlanFormMode =
  | {
      kind: "create";
      accountKey: number;
      currency: string;
      draft?: InstallmentPlanDraft;
    }
  | { kind: "edit"; plan: InstallmentPlan };

interface FormValues {
  description: string;
  purchaseDate: string;
  totalAmount: string | number;
  installmentCount: string;
  categoryKey: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const todayDay = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function defaultValues(
  mode: InstallmentPlanFormMode,
  locale: string,
): FormValues {
  if (mode.kind === "edit") {
    return {
      description: mode.plan.description,
      purchaseDate: mode.plan.purchaseDate,
      totalAmount: formatLocaleNumberInput(mode.plan.totalAmount, locale),
      installmentCount: String(mode.plan.installmentCount),
      categoryKey: mode.plan.categoryKey ? String(mode.plan.categoryKey) : "",
    };
  }
  const draft = mode.draft ?? {};
  return {
    description: draft.description ?? "",
    purchaseDate: draft.purchaseDate ?? todayDay(),
    totalAmount:
      draft.totalAmount === undefined
        ? ""
        : formatLocaleNumberInput(draft.totalAmount, locale),
    installmentCount:
      draft.installmentCount === undefined
        ? ""
        : String(draft.installmentCount),
    categoryKey: draft.categoryKey ? String(draft.categoryKey) : "",
  };
}

/**
 * Create a card installment plan, or edit one's description and category. While the total and
 * the count are typed, the form previews each installment with the API's own rule (whole cents,
 * the last one takes the remainder), so what is shown is what will be stored.
 */
export default function InstallmentPlanFormDialog({
  open,
  onOpenChange,
  mode,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: InstallmentPlanFormMode;
  categories: Category[];
  onSaved?: (plan: InstallmentPlanDetail) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const createPlan = useCreateInstallmentPlan();
  const updatePlan = useUpdateInstallmentPlan();
  const isEdit = mode.kind === "edit";
  const currency = mode.kind === "edit" ? mode.plan.currency : mode.currency;
  const links = mode.kind === "create" ? (mode.draft?.links ?? []) : [];

  const schema = z.object({
    description: z
      .string()
      .trim()
      .min(1, { message: t("installments.description-required") })
      .max(255),
    purchaseDate: z
      .string()
      .regex(DATE_PATTERN, {
        message: t("installments.purchase-date-required"),
      }),
    totalAmount: zLocaleNumber(locale, t("installments.amount-positive"), {
      expressions: true,
    }).pipe(z.number().gt(0, { message: t("installments.amount-positive") })),
    installmentCount: z
      .string()
      .trim()
      .regex(/^\d+$/, { message: t("installments.installment-count-range") })
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(MIN_INSTALLMENTS, {
            message: t("installments.installment-count-range"),
          })
          .max(MAX_INSTALLMENTS, {
            message: t("installments.installment-count-range"),
          }),
      ),
    categoryKey: z.string(),
  });
  type Parsed = z.output<typeof schema>;

  const form = useForm<FormValues, undefined, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(mode, locale),
  });

  // Each opening starts from the plan or the suggestion it was opened for.
  const resetKey =
    mode.kind === "edit"
      ? `edit-${mode.plan.installmentPlanKey}`
      : `create-${mode.accountKey}-${mode.draft?.links?.map((link) => link.transactionKey).join(",") ?? ""}`;
  useEffect(() => {
    if (open) form.reset(defaultValues(mode, locale));
    // `mode` is a fresh object every render; `resetKey` names what it describes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey, locale]);

  const [watchedTotal, watchedCount] = useWatch({
    control: form.control,
    name: ["totalAmount", "installmentCount"],
  });
  const preview = installmentPreview(
    parseAmountInput(String(watchedTotal ?? ""), locale) ?? Number.NaN,
    /^\d+$/.test(String(watchedCount ?? "").trim())
      ? Number(watchedCount)
      : Number.NaN,
  );

  const pending = createPlan.isPending || updatePlan.isPending;

  const onSubmit = async (values: Parsed) => {
    const categoryKey = values.categoryKey ? Number(values.categoryKey) : null;
    try {
      const plan =
        mode.kind === "edit"
          ? await updatePlan.mutateAsync({
              installmentPlanKey: mode.plan.installmentPlanKey,
              description: values.description,
              categoryKey,
            })
          : await createPlan.mutateAsync({
              accountKey: mode.accountKey,
              description: values.description,
              purchaseDate: values.purchaseDate,
              totalAmount: values.totalAmount,
              installmentCount: values.installmentCount,
              categoryKey,
              ...(links.length > 0 ? { links } : {}),
            });
      toast.success(
        t(isEdit ? "installments.updated" : "installments.created"),
      );
      onOpenChange(false);
      onSaved?.(plan);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      toast.error(
        isAxiosError(error) && error.response?.status === 409
          ? t("installments.already-linked")
          : t("installments.save-failed"),
        { duration: 9000 },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(
              isEdit
                ? "installments.form-edit-title"
                : "installments.form-create-title",
            )}
          </DialogTitle>
          <DialogDescription>
            {t("installments.form-description")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="installment-plan-form"
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
          >
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>
                    {t("installments.description")}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={255} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isEdit ? null : (
              <>
                <FormField
                  control={form.control}
                  name="purchaseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t("installments.purchase-date")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="date"
                          className="font-mono tabular-nums"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="totalAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t("installments.total-amount")}
                        </FormLabel>
                        <FormControl>
                          <MoneyInput
                            {...field}
                            currency={currency}
                            inputMode="decimal"
                            onEvaluated={(value) => field.onChange(value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="installmentCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t("installments.installment-count")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            inputMode="numeric"
                            min={MIN_INSTALLMENTS}
                            max={MAX_INSTALLMENTS}
                            step={1}
                            className="font-mono tabular-nums"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div
                  className="bg-muted/40 border-border rounded-md border border-dashed px-3 py-2"
                  aria-live="polite"
                  data-testid="installment-preview"
                >
                  <p className="text-muted-foreground text-xs">
                    {t("installments.preview-label")}
                  </p>
                  <p className="text-foreground font-mono text-sm tabular-nums">
                    {preview === null
                      ? t("installments.preview-empty")
                      : preview.regular === preview.last
                        ? t("installments.preview-even", {
                            count: preview.count,
                            amount: formatCurrency(preview.regular, currency),
                          })
                        : t("installments.preview-uneven", {
                            regularCount: preview.count - 1,
                            amount: formatCurrency(preview.regular, currency),
                            last: formatCurrency(preview.last, currency),
                          })}
                  </p>
                </div>
              </>
            )}
            <FormField
              control={form.control}
              name="categoryKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("installments.category")}</FormLabel>
                  <CategorySelect
                    categories={categories}
                    initialValue={field.value || undefined}
                    onChange={(value) => field.onChange(value)}
                    triggerProps={{
                      variant: "input",
                      size: "default",
                      className: "ml-0 w-full",
                      "aria-label": t("installments.category"),
                    }}
                  />
                  <FormDescription>
                    {t("installments.category-optional")}
                  </FormDescription>
                </FormItem>
              )}
            />
            {links.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("installments.links-note", { count: links.length })}
              </p>
            ) : null}
          </form>
        </Form>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="installment-plan-form"
            loading={pending}
            disabled={pending}
          >
            {isEdit ? t("save") : t("installments.create-plan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
