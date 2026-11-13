"use client";

import { useQueries } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/Spinner";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { TransactionInstallment } from "@/lib/api/installment-plans/types";
import {
  type InstallmentLinkError,
  installmentLinkError,
  useLinkInstallment,
} from "@/lib/api/installment-plans/useInstallmentPlanMutations";
import useInstallmentPlans, {
  getInstallmentPlan,
  installmentPlanKeys,
} from "@/lib/api/installment-plans/useInstallmentPlans";
import {
  installmentTargets,
  isLinkableRow,
} from "@/lib/installments/installment-link-candidates";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { LinkOptionList } from "./LinkOptionList";
import { useFormatPlanDay } from "./useFormatPlanDay";

type LinkableTransaction = Pick<
  Transaction,
  | "transactionKey"
  | "transactionDate"
  | "settlementAmount"
  | "hidden"
  | "installment"
  | "accountKey"
>;

/**
 * "Link to installment" in the transaction inspector: offered on a charge that pays no installment
 * yet, on a card that has installment plans. It opens the open installments of those plans that
 * the charge could pay, closest first.
 */
export function TransactionInstallmentLinkAction({
  transaction,
  onLinked,
}: {
  transaction: LinkableTransaction;
  /** The row now pays this installment; the inspector shows it before the list refetches. */
  onLinked?: (installment: TransactionInstallment) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const linkable = isLinkableRow(transaction);
  const plans = useInstallmentPlans(transaction.accountKey.accountKey, {
    enabled: linkable,
  });
  const openPlans = (plans.data?.installmentPlans ?? []).filter(
    (plan) => plan.remainingCount + plan.unmatchedCount > 0,
  );
  if (!linkable || openPlans.length === 0) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Link2 className="mr-2 size-3.5" aria-hidden="true" />
        {t("installments.link-to-installment")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {open ? (
            <TransactionLinkBody
              transaction={transaction}
              planKeys={openPlans.map((plan) => plan.installmentPlanKey)}
              onDone={(linked) => {
                setOpen(false);
                if (linked) onLinked?.(linked);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransactionLinkBody({
  transaction,
  planKeys,
  onDone,
}: {
  transaction: LinkableTransaction;
  planKeys: number[];
  onDone: (linked?: TransactionInstallment) => void;
}) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const formatCurrency = useFormatCurrency();
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [failure, setFailure] = useState<InstallmentLinkError | null>(null);
  const link = useLinkInstallment();

  const details = useQueries({
    queries: planKeys.map((planKey) => ({
      queryKey: installmentPlanKeys.detail(planKey),
      queryFn: () => getInstallmentPlan(planKey),
    })),
  });
  const loading = details.some((query) => query.isLoading);
  const failed = details.some((query) => query.isError);
  const plans = details.flatMap((query) =>
    query.data ? [query.data.installmentPlan] : [],
  );
  const targets = installmentTargets(plans, transaction, {
    showAllAmounts: showAll,
  });
  const keyOf = (planKey: number, number: number) => `${planKey}:${number}`;
  const chosenTarget =
    targets.find(
      (target) =>
        keyOf(
          target.plan.installmentPlanKey,
          target.installment.installmentNumber,
        ) === chosen,
    ) ?? null;
  const currency = transaction.accountKey.currencyKey.code;

  const onLink = async () => {
    if (!chosenTarget) return;
    setFailure(null);
    try {
      await link.mutateAsync({
        installmentPlanKey: chosenTarget.plan.installmentPlanKey,
        installmentNumber: chosenTarget.installment.installmentNumber,
        transactionKey: transaction.transactionKey,
      });
      toast.success(
        t("installments.linked", {
          number: chosenTarget.installment.installmentNumber,
        }),
      );
      onDone({
        installmentPlanKey: chosenTarget.plan.installmentPlanKey,
        installmentNumber: chosenTarget.installment.installmentNumber,
        installmentCount: chosenTarget.plan.installmentCount,
      });
    } catch (error) {
      const reason = installmentLinkError(error);
      if (reason === "demo") {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      setFailure(reason);
    }
  };

  /** How the installment compares with this charge. */
  const differenceNote = (difference: number) =>
    difference === 0
      ? null
      : t(
          difference > 0
            ? "installments.link-installment-more"
            : "installments.link-installment-less",
          { amount: formatCurrency(Math.abs(difference), currency) },
        );

  const description = t(
    showAll
      ? "installments.link-installment-description-all"
      : "installments.link-installment-description",
    {
      account: transaction.accountKey.accountName,
      amount: formatCurrency(Math.abs(transaction.settlementAmount), currency),
    },
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("installments.link-installment-title")}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex min-w-0 flex-col gap-3">
        {loading ? (
          <div
            className="text-muted-foreground flex items-center gap-2 text-sm"
            role="status"
          >
            <Spinner />
          </div>
        ) : failed && plans.length === 0 ? (
          <p className="text-destructive-text text-sm" role="alert">
            {t("installments.load-failed")}
          </p>
        ) : targets.length === 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-foreground">
              {t("installments.link-installment-empty")}
            </p>
            {showAll ? null : (
              <p className="text-muted-foreground">
                {t("installments.link-installment-empty-hint")}
              </p>
            )}
          </div>
        ) : (
          <LinkOptionList
            name={`transaction-${transaction.transactionKey}-installments`}
            label={t("installments.link-installment-title")}
            currency={currency}
            value={chosenTarget ? chosen : null}
            onChange={setChosen}
            options={targets.map((target) => ({
              key: keyOf(
                target.plan.installmentPlanKey,
                target.installment.installmentNumber,
              ),
              title: t("installments.link-installment-option", {
                description: target.plan.description,
                number: target.installment.installmentNumber,
                count: target.plan.installmentCount,
              }),
              date: formatPlanDay(target.installment.scheduledDate, {
                alwaysShowYear: true,
              }),
              amount: target.installment.amount,
              note: differenceNote(-target.amountDifference),
            }))}
          />
        )}

        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {t(
              showAll
                ? "installments.link-show-close-installments"
                : "installments.link-show-all-installments",
            )}
          </Button>
        </div>

        {failure ? (
          <p className="text-destructive-text text-sm" role="alert">
            {t(`installments.link-errors.${failure}`)}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => onDone()}
          disabled={link.isPending}
        >
          {t("cancel")}
        </Button>
        <Button
          onClick={() => void onLink()}
          disabled={!chosenTarget || link.isPending}
          loading={link.isPending}
        >
          {t("installments.link-confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
