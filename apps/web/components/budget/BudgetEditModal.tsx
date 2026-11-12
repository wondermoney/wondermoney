"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/i18n/navigation";
import { Budget } from "@/lib/api/budget/useBudgets";
import useEditBudget from "@/lib/api/budget/useEditBudget";
import { BUDGET_PERIOD_START_DAYS } from "@/lib/budget/period";
import { invalidateBudgets } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

interface BudgetEditModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  budgetName: Budget["name"];
  budgetKey: Budget["budgetKey"];
  /** The budget's current setting; the API's default (on) when unknown. */
  rolloverCarriesOverspend?: boolean;
  /** The day its months start on; the API's default (1, the calendar month) when unknown. */
  periodStartDay?: number;
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  periodStartDay: z.number().int().min(1).max(28),
  rolloverCarriesOverspend: z.boolean(),
});

type FormSchema = z.infer<typeof formSchema>;

const BudgetEditModal: React.FC<BudgetEditModalProps> = ({
  isOpen,
  onOpenChange,
  budgetName,
  budgetKey,
  rolloverCarriesOverspend = true,
  periodStartDay = 1,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: budgetName,
      periodStartDay,
      rolloverCarriesOverspend,
    },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;
  const editBudgetMutation = useEditBudget();
  const qc = useQueryClient();
  const router = useRouter();

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    await editBudgetMutation.mutateAsync(
      {
        budgetKey,
        name: data.name,
        // Only a changed setting is sent, so a rename stays a rename.
        ...(data.periodStartDay !== periodStartDay
          ? { periodStartDay: data.periodStartDay }
          : {}),
        ...(data.rolloverCarriesOverspend !== rolloverCarriesOverspend
          ? { rolloverCarriesOverspend: data.rolloverCarriesOverspend }
          : {}),
      },
      {
        onSuccess: () => {
          posthog.capture("budget_edited", { budget_key: budgetKey });
        },
        onSettled: async () => {
          await invalidateBudgets(qc, { refresh: () => router.refresh() });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("edit-budget")}</SheetTitle>
          <SheetDescription>{t("edit-budget-description")}</SheetDescription>
        </SheetHeader>
        <Form {...methods}>
          <form
            className="my-8 w-full space-y-6"
            onSubmit={handleSubmit(onSubmit)}
            id="edit-budget-sheet"
          >
            <FormField
              control={methods.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("budget-name")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={methods.control}
              name="periodStartDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("budget-period-start-day")}</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <FormControl>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BUDGET_PERIOD_START_DAYS.map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {t("budget-period-start-day-option", { day })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t("budget-period-start-day-help")}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={methods.control}
              name="rolloverCarriesOverspend"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("budget-rollover-carries-overspend")}
                    </FormLabel>
                    <FormDescription>
                      {t("budget-rollover-carries-overspend-help")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            form="edit-budget-sheet"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default BudgetEditModal;
