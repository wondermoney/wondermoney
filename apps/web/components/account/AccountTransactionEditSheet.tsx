"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo } from "react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import TransactionActivity from "@/components/account/TransactionActivity";
import { Amount } from "@/components/ui/Amount";
import useEditTransaction from "@/lib/api/account/useEditTransaction";
import { Transaction } from "@/lib/api/account/useTransactions";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { zLocaleNumber } from "@/lib/utils/number";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { Button } from "../ui/button";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Textarea } from "../ui/textarea";

type Props = {
  transaction: Transaction;
  isOpen: boolean;
  onFundGoal: (request: FundGoalTransactionRequest) => void;
  onOpenChange: (open: boolean) => void;
};

export type FundGoalTransactionRequest = {
  currencyCode?: string;
  maxAmount: number;
  transactionKey: number;
};

type FormSchema = {
  updatedAmount: number;
  description?: string;
};

export function AccountTransactionEditSheet({
  transaction,
  isOpen,
  onFundGoal,
  onOpenChange,
}: Props) {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const posthog = usePostHog();

  const formSchema = z.object({
    updatedAmount: zLocaleNumber,
    description: z.string().optional(),
  });

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      updatedAmount: transaction.settlementAmount,
      description: transaction.description ?? "",
    },
  });
  const {
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = form;
  const watchedAmount = useWatch({
    control: form.control,
    name: "updatedAmount",
  });

  const transactionAmount = useMemo(
    () =>
      Number(
        watchedAmount ??
          transaction.editedSettlementAmount ??
          transaction.appuserSettlementAmount ??
          transaction.settlementAmount,
      ),
    [
      transaction.appuserSettlementAmount,
      transaction.editedSettlementAmount,
      transaction.settlementAmount,
      watchedAmount,
    ],
  );
  const maxFundAmount = Math.abs(transactionAmount);
  const canFundWithGoal = maxFundAmount > 0 && transactionAmount < 0;

  const editTransactionMutation = useEditTransaction();
  const queryClient = useQueryClient();
  const formatCurrency = useFormatCurrency();

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    // If the amount is the same, we don't need to edit it
    if (data.updatedAmount === transaction.settlementAmount) {
      onOpenChange(false);
      return;
    }
    await editTransactionMutation.mutateAsync(
      {
        transactionKey: transaction.transactionKey,
        updatedAmount: data.updatedAmount,
      },
      {
        onSuccess: async () => {
          posthog.capture("transaction_edited", {
            field: "amount",
          });
          await queryClient.invalidateQueries({
            queryKey: ["accounts-transactions"],
          });
          reset();
          onOpenChange(false);
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          if (isDemoReadOnlyError(error)) {
            toast.error(t("demo-read-only-title"), {
              description: t("demo-read-only-description"),
              duration: 9000,
            });
            return;
          }

          toast.error(
            getApiErrorMessage(error) ?? t("toast-edit-transaction-error"),
            {
              duration: 9000,
            },
          );
        },
      },
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("edit-transaction")}</SheetTitle>
          <SheetDescription>
            {t("edit-transaction-description")}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="my-8 w-full space-y-6"
            onSubmit={handleSubmit(onSubmit)}
            id="edit-account-transaction-form"
          >
            <FormField
              control={form.control}
              name="updatedAmount"
              defaultValue={transaction.settlementAmount}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("amount")}</FormLabel>
                  <FormControl>
                    <Input type="tel" step="0.01" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("original-settlement-amount")}:{" "}
                    <Amount value={transaction.settlementAmount} currency={transaction.settlementCurrencyKey.code} />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{t("goals.fund-transaction")}</p>
                  <p className="text-muted-foreground text-sm">
                    {canFundWithGoal
                      ? t("goals.fund-transaction-description")
                      : t("goals.fund-transaction-disabled")}
                  </p>
                </div>
                <Button
                  type="button"
                  className="shrink-0"
                  disabled={!canFundWithGoal}
                  onClick={() =>
                    onFundGoal({
                      currencyCode:
                        transaction.appuserCurrencyKey?.code ??
                        transaction.settlementCurrencyKey.code,
                      maxAmount: maxFundAmount,
                      transactionKey: transaction.transactionKey,
                    })
                  }
                >
                  {t("goals.fund-transaction-action")}
                </Button>
              </div>
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("description")}</FormLabel>
                  <FormControl>
                    <Textarea placeholder={t("description")} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("original-description")}: {transaction.descriptionDirty}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <div className="border-border border-t pt-4">
          <TransactionActivity transactionId={transaction.transactionKey} />
        </div>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            form="edit-account-transaction-form"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
