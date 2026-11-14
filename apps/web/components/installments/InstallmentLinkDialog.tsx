"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
import useTransactions from "@/lib/api/account/useTransactions";
import type {
  Installment,
  InstallmentPlanDetail,
} from "@/lib/api/installment-plans/types";
import {
  type InstallmentLinkError,
  installmentLinkError,
  useLinkInstallment,
} from "@/lib/api/installment-plans/useInstallmentPlanMutations";
import {
  linkCandidates,
  linkSearchWindow,
} from "@/lib/installments/installment-link-candidates";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

import { LinkOptionList } from "./LinkOptionList";
import { useFormatPlanDay } from "./useFormatPlanDay";

/** The most rows one search reads: two months of a busy card. */
const SEARCH_LIMIT = 500;

/**
 * "Link transaction" for one installment: the posted charges on the plan's card within about a
 * month of its scheduled day, closest amount first, from the transaction list API. Only rows of
 * about the installment's amount show until "Show other amounts". Refusals from the API (another
 * card, already linked, gone) are said in the dialog; a link refreshes the plan, the commitments
 * and the transaction lists.
 */
export default function InstallmentLinkDialog({
  plan,
  installment,
  onOpenChange,
}: {
  plan: Pick<
    InstallmentPlanDetail,
    | "installmentPlanKey"
    | "installmentCount"
    | "accountKey"
    | "accountName"
    | "currency"
  >;
  /** The installment to link; null keeps the dialog closed. */
  installment: Installment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = installment !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {installment ? (
          <LinkDialogBody
            key={installment.installmentNumber}
            plan={plan}
            installment={installment}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LinkDialogBody({
  plan,
  installment,
  onDone,
}: {
  plan: Parameters<typeof InstallmentLinkDialog>[0]["plan"];
  installment: Installment;
  onDone: () => void;
}) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const formatShortDate = useFormatShortDate();
  const formatCurrency = useFormatCurrency();
  const [showAllAmounts, setShowAllAmounts] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [failure, setFailure] = useState<InstallmentLinkError | null>(null);
  const link = useLinkInstallment();

  const range = useMemo(
    () => linkSearchWindow(installment.scheduledDate),
    [installment.scheduledDate],
  );
  const search = useTransactions({
    accountKeys: [String(plan.accountKey)],
    fromDate: range.fromDate,
    toDate: range.toDate,
    statuses: ["BOOKED"],
    direction: "out",
    limit: SEARCH_LIMIT,
  });

  const candidates = useMemo(
    () =>
      linkCandidates(search.data?.transactions ?? [], installment, {
        showAllAmounts,
      }),
    [search.data, installment, showAllAmounts],
  );
  const chosenKey = candidates.some(
    (candidate) => String(candidate.row.transactionKey) === chosen,
  )
    ? chosen
    : null;

  const onLink = async () => {
    if (!chosenKey) return;
    setFailure(null);
    try {
      await link.mutateAsync({
        installmentPlanKey: plan.installmentPlanKey,
        installmentNumber: installment.installmentNumber,
        transactionKey: Number(chosenKey),
      });
      toast.success(
        t("installments.linked", { number: installment.installmentNumber }),
      );
      onDone();
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

  /** How the charge compares with the installment. */
  const differenceNote = (difference: number) =>
    difference === 0
      ? null
      : t(
          difference > 0
            ? "installments.link-amount-more"
            : "installments.link-amount-less",
          { amount: formatCurrency(Math.abs(difference), plan.currency) },
        );

  const numbers = {
    number: installment.installmentNumber,
    count: plan.installmentCount,
  };
  const description = t(
    showAllAmounts
      ? "installments.link-description-all"
      : "installments.link-description",
    {
      account: plan.accountName,
      date: formatPlanDay(installment.scheduledDate, { alwaysShowYear: true }),
      amount: formatCurrency(installment.amount, plan.currency),
    },
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("installments.link-title", numbers)}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex min-w-0 flex-col gap-3">
        {search.isLoading ? (
          <div
            className="text-muted-foreground flex items-center gap-2 text-sm"
            role="status"
          >
            <Spinner />
            {t("installments.link-searching")}
          </div>
        ) : search.isError ? (
          <p className="text-destructive-text text-sm" role="alert">
            {t("installments.link-load-failed")}
          </p>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-foreground">{t("installments.link-empty")}</p>
            {showAllAmounts ? null : (
              <p className="text-muted-foreground">
                {t("installments.link-empty-hint")}
              </p>
            )}
          </div>
        ) : (
          <LinkOptionList
            name={`installment-${installment.installmentNumber}-candidates`}
            label={t("installments.link-candidates")}
            currency={plan.currency}
            value={chosenKey}
            onChange={setChosen}
            options={candidates.map((candidate) => ({
              key: String(candidate.row.transactionKey),
              title:
                candidate.row.transactionMerchantKey?.name.trim() ||
                candidate.row.description ||
                "—",
              date: formatShortDate(
                transactionDisplayDate(candidate.row.transactionDate),
                { alwaysShowYear: true },
              ),
              amount: candidate.amount,
              note: differenceNote(candidate.amountDifference),
            }))}
          />
        )}

        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAllAmounts}
            onClick={() => setShowAllAmounts((value) => !value)}
          >
            {t(
              showAllAmounts
                ? "installments.link-show-close-amounts"
                : "installments.link-show-other-amounts",
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
        <Button variant="ghost" onClick={onDone} disabled={link.isPending}>
          {t("cancel")}
        </Button>
        <Button
          onClick={() => void onLink()}
          disabled={!chosenKey || link.isPending}
          loading={link.isPending}
        >
          {t("installments.link-confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
