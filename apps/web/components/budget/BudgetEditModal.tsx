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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { useRouter } from "@/i18n/navigation";
import { Budget } from "@/lib/api/budget/useBudgets";
import useEditBudget from "@/lib/api/budget/useEditBudget";
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
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type FormSchema = z.infer<typeof formSchema>;

const BudgetEditModal: React.FC<BudgetEditModalProps> = ({
  isOpen,
  onOpenChange,
  budgetName,
  budgetKey,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: budgetName,
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
      { budgetKey, name: data.name },
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
            className="my-8 w-full"
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
