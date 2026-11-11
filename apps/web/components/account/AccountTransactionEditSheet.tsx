"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useMemo, useState } from "react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import TransactionActivity from "@/components/account/TransactionActivity";
import {
  splitSaveErrorKey,
  TransactionSplitField,
  useSplitDraft,
} from "@/components/account/TransactionSplitField";
import { TransactionTransferFields } from "@/components/account/TransactionTransferFields";
import { ApplyRulesDialog } from "@/components/rules/ApplyRulesDialog";
import { RuleEditorDialog } from "@/components/rules/RuleEditorDialog";
import { TagPicker } from "@/components/tags/TagPicker";
import { Amount } from "@/components/ui/Amount";
import { amountToUnits, toSplitRequest } from "@/lib/account/transaction-split";
import {
  buildTransferEdit,
  isTransferType,
  type TransferDestination,
} from "@/lib/account/transaction-transfer";
import useEditTransaction from "@/lib/api/account/useEditTransaction";
import { Transaction } from "@/lib/api/account/useTransactions";
import {
  invalidateTransactionSplits,
  useSetTransactionSplits,
} from "@/lib/api/account/useTransactionSplits";
import type { Category } from "@/lib/api/category/useCategories";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type { Rule } from "@/lib/api/rule/useRules";
import { invalidateTags, useSetTransactionTags } from "@/lib/api/tag/useTags";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { formFromTransaction } from "@/lib/rules/rule-draft";
import {
  amountExpressionResult,
  formatLocaleNumberInput,
  parseAmountInput,
  zLocaleNumber,
} from "@/lib/utils/number";
import { invalidateSpendingTotals } from "@/lib/utils/queryInvalidation";

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
import { Label } from "../ui/Label";
import { AmountExpressionHint } from "../ui/MoneyInput";
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
  /** For the split lines' category pickers. */
  categories: Category[];
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
  categories,
  isOpen,
  onFundGoal,
  onOpenChange,
}: Props) {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const posthog = usePostHog();

  const locale = useLocale();
  const formSchema = z.object({
    updatedAmount: zLocaleNumber(locale, t("invalid-amount"), {
      expressions: true,
    }),
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
      typeof watchedAmount === "string"
        ? (parseAmountInput(watchedAmount, locale) ?? Number.NaN)
        : Number(
            watchedAmount ??
              transaction.editedSettlementAmount ??
              transaction.appuserSettlementAmount ??
              transaction.settlementAmount,
          ),
    [
      locale,
      transaction.appuserSettlementAmount,
      transaction.editedSettlementAmount,
      transaction.settlementAmount,
      watchedAmount,
    ],
  );
  const maxFundAmount = Math.abs(transactionAmount);
  const canFundWithGoal = maxFundAmount > 0 && transactionAmount < 0;

  // What split lines must add up to: the amount in the field (when it reads as a non-zero
  // number), so an amount edit and a split are saved together, in the settlement currency.
  const splitTotalUnits = useMemo(() => {
    const typed =
      typeof watchedAmount === "string"
        ? parseAmountInput(watchedAmount, locale)
        : Number(watchedAmount ?? transaction.settlementAmount);
    return amountToUnits(
      typed !== null && Number.isFinite(typed) && typed !== 0
        ? typed
        : transaction.settlementAmount,
    );
  }, [locale, transaction.settlementAmount, watchedAmount]);
  const split = useSplitDraft(transaction, splitTotalUnits);
  const amountFieldChanged =
    splitTotalUnits !== amountToUnits(transaction.settlementAmount);

  const editTransactionMutation = useEditTransaction();
  const setTransactionSplitsMutation = useSetTransactionSplits();
  const setTransactionTagsMutation = useSetTransactionTags();
  const queryClient = useQueryClient();

  const initialTagKeys = useMemo(
    () => (transaction.tags ?? []).map((tag) => tag.tagKey),
    [transaction.tags],
  );
  const [tagKeys, setTagKeys] = useState<number[]>(initialTagKeys);
  const [creatingRule, setCreatingRule] = useState(false);
  const [applyingRule, setApplyingRule] = useState<Rule | null>(null);
  const closeApplyingRule = useCallback(() => setApplyingRule(null), []);
  const initialTransfer = isTransferType(transaction.transactionTypeKey?.name);
  const initialDestination: TransferDestination | null =
    transaction.transferDestination
      ? {
          type: transaction.transferDestination.type,
          key: transaction.transferDestination.key,
        }
      : null;
  const [isTransfer, setIsTransfer] = useState(initialTransfer);
  const [transferDestination, setTransferDestination] =
    useState<TransferDestination | null>(initialDestination);
  // The row's direction is its stored amount's sign: an amount edit cannot flip it.
  const rowAmount = Number(
    transaction.editedSettlementAmount ?? transaction.settlementAmount,
  );
  const transferEdit = buildTransferEdit(
    {
      amount: rowAmount,
      transactionType: transaction.transactionTypeKey?.name,
      transferDestination: initialDestination,
    },
    { transfer: isTransfer, destination: transferDestination },
  );
  const transferChanged = Object.keys(transferEdit).length > 0;
  const tagsChanged =
    tagKeys.length !== initialTagKeys.length ||
    tagKeys.some((key) => !initialTagKeys.includes(key));

  const notifyError = (error: unknown) => {
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
  };

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    // Only what changed is sent: an unchanged amount or tag list is no request.
    const amountChanged = data.updatedAmount !== transaction.settlementAmount;
    try {
      if (amountChanged) {
        await editTransactionMutation.mutateAsync({
          transactionKey: transaction.transactionKey,
          updatedAmount: data.updatedAmount,
        });
        posthog.capture("transaction_edited", { field: "amount" });
      }
      if (transferChanged) {
        await editTransactionMutation.mutateAsync({
          transactionKey: transaction.transactionKey,
          ...transferEdit,
        });
        posthog.capture("transaction_edited", { field: "transfer" });
      }
      if (split.changed) {
        try {
          await setTransactionSplitsMutation.mutateAsync({
            transactionKey: transaction.transactionKey,
            lines: toSplitRequest(split.lines, split.summary),
          });
        } catch (error) {
          const key = splitSaveErrorKey(error);
          if (key) {
            toast.error(t(`transactionSplit.${key}`), { duration: 9000 });
            // An amount saved just before is in; refresh so the sheet's source row is too.
            if (amountChanged) {
              await queryClient.invalidateQueries({
                queryKey: ["accounts-transactions"],
              });
            }
            return;
          }
          throw error;
        }
        posthog.capture("transaction_edited", {
          field: "splits",
          lines: split.lines.length,
        });
      }
      if (tagsChanged) {
        await setTransactionTagsMutation.mutateAsync({
          transactionKey: transaction.transactionKey,
          tagKeys,
        });
        posthog.capture("transaction_edited", { field: "tags" });
      }
    } catch (error) {
      notifyError(error);
      return;
    }
    if (amountChanged || transferChanged) {
      await invalidateSpendingTotals(queryClient);
    }
    if (split.changed) {
      await invalidateTransactionSplits(
        queryClient,
        transaction.transactionKey,
      );
    }
    if (tagsChanged) await invalidateTags(queryClient);
    reset();
    onOpenChange(false);
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
              render={({ field }) => {
                const settleExpression = () => {
                  const result = amountExpressionResult(
                    String(field.value ?? ""),
                    locale,
                  );
                  if (result === null) return false;
                  field.onChange(formatLocaleNumberInput(result, locale));
                  return true;
                };
                return (
                  <FormItem>
                    <FormLabel>{t("amount")}</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="decimal"
                        {...field}
                        value={formatLocaleNumberInput(field.value, locale)}
                        onBlur={() => {
                          field.onBlur();
                          settleExpression();
                        }}
                        onKeyDown={(event) => {
                          // Enter settles the expression; a second Enter submits.
                          if (event.key === "Enter" && settleExpression()) {
                            event.preventDefault();
                          }
                        }}
                      />
                    </FormControl>
                    <AmountExpressionHint
                      locale={locale}
                      value={String(field.value ?? "")}
                    />
                    <FormDescription>
                      {t("original-settlement-amount")}:{" "}
                      <Amount
                        value={transaction.settlementAmount}
                        currency={transaction.settlementCurrencyKey.code}
                      />
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            {/* Its category, or the lines of its split. */}
            <TransactionSplitField
              split={split}
              transaction={transaction}
              categories={categories}
              amountChanged={amountFieldChanged}
              disabled={isSubmitting}
              onRemoved={() => onOpenChange(false)}
            />
            {/* The transaction's tags, with "create tag" inline. */}
            <div className="space-y-2">
              <Label htmlFor="edit-transaction-tags">
                {t("transactionTags.label")}
              </Label>
              <TagPicker
                id="edit-transaction-tags"
                value={tagKeys}
                onChange={setTagKeys}
                disabled={isSubmitting}
              />
            </div>
            <TransactionTransferFields
              accountKey={transaction.accountKey.accountKey}
              amount={rowAmount}
              destination={transferDestination}
              disabled={isSubmitting}
              isTransfer={isTransfer}
              onDestinationChange={setTransferDestination}
              onTransferChange={(transfer) => {
                setIsTransfer(transfer);
                if (!transfer) setTransferDestination(null);
              }}
            />
            <div className="bg-muted space-y-3 rounded-md p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("goals.fund-transaction")}
                </p>
                <p className="text-muted-foreground text-sm">
                  {canFundWithGoal
                    ? t("goals.fund-transaction-description")
                    : t("goals.fund-transaction-disabled")}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
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
        <div className="bg-muted mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md p-4">
          <p className="text-muted-foreground text-sm">
            {t("rules.from-transaction-hint")}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCreatingRule(true)}
          >
            {t("rules.from-transaction")}
          </Button>
        </div>
        {creatingRule ? (
          <RuleEditorDialog
            open
            initialForm={formFromTransaction(transaction)}
            onOpenChange={setCreatingRule}
            onSaved={(saved) => {
              if (saved.active) setApplyingRule(saved);
            }}
          />
        ) : null}
        {applyingRule ? (
          <ApplyRulesDialog
            key={applyingRule.ruleKey}
            target={{ ruleKey: applyingRule.ruleKey }}
            ruleName={applyingRule.name}
            offer
            onClose={closeApplyingRule}
          />
        ) : null}
        <div className="border-border border-t pt-4">
          <TransactionActivity transactionId={transaction.transactionKey} />
        </div>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            // Lines that do not add up to the amount cannot be saved.
            disabled={isSubmitting || split.blocked}
            form="edit-account-transaction-form"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
