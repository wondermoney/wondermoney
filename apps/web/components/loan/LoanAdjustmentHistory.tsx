"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import type {
  LoanAdjustment,
  LoanAdjustmentType,
  LoanDetail,
} from "@/lib/api/loan/types";
import {
  useLoanAdjustmentMutations,
  useLoanAdjustments,
} from "@/lib/api/loan/useLoanHistory";
import { parseDateInputValue } from "@/lib/loans/calendar-day";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** How an adjustment moves the balance, shown as a sign beside its amount. */
const EFFECT: Record<LoanAdjustmentType, "set" | "up" | "down"> = {
  BALANCE_CORRECTION: "set",
  FEE: "up",
  CAPITALIZED_INTEREST: "up",
  PRINCIPAL_INCREASE: "up",
  PRINCIPAL_DECREASE: "down",
  WRITE_OFF: "down",
};

/** The loan's balance adjustments, oldest first, each editable and removable. */
export default function LoanAdjustmentHistory({
  loan,
  onAdd,
  onEdit,
}: {
  loan: LoanDetail;
  onAdd: () => void;
  onEdit: (adjustment: LoanAdjustment) => void;
}) {
  const t = useTranslations("loans.detail.adjustment");
  const tCommon = useTranslations();
  const formatShortDate = useFormatShortDate();
  const { data, isLoading, isError } = useLoanAdjustments(loan.loanKey);
  const { remove } = useLoanAdjustmentMutations(loan.loanKey);
  const adjustments = data?.adjustments ?? [];

  const removeAdjustment = async (adjustment: LoanAdjustment) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      await remove.mutateAsync(adjustment.loanAdjustmentKey);
    } catch (error) {
      toast.error(
        isDemoReadOnlyError(error)
          ? tCommon("demo-read-only-title")
          : (getApiErrorMessage(error) ?? t("saveError")),
      );
    }
  };

  const addButton = (
    <Button variant="secondary" size="sm" onClick={onAdd}>
      <Plus className="mr-2 size-4" aria-hidden="true" />
      {t("add")}
    </Button>
  );

  return (
    <Section
      id="loan-adjustments-heading"
      title={t("history")}
      busy={isLoading}
      aside={adjustments.length > 0 ? addButton : undefined}
    >
      {isLoading ? (
        <RowsSkeleton rows={2} />
      ) : isError ? (
        <p role="alert" className="text-destructive-text text-sm">
          {t("loadError")}
        </p>
      ) : adjustments.length === 0 ? (
        <SectionEmpty
          title={t("empty")}
          body={t("emptyBody")}
          action={addButton}
        />
      ) : (
        <ul>
          {adjustments.map((adjustment) => {
            const effect = EFFECT[adjustment.type];
            const date = parseDateInputValue(adjustment.effectiveDate);
            return (
              <li
                key={adjustment.loanAdjustmentKey}
                className="border-border flex min-h-14 items-center justify-between gap-4 border-b py-3"
              >
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium">
                    {t(`types.${adjustment.type}`)}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {date ? formatShortDate(date) : null}
                    {adjustment.reason ? `, ${adjustment.reason}` : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm">
                    {effect === "set" ? (
                      t.rich("setTo", {
                        amount: () => (
                          <Amount
                            value={adjustment.amount}
                            currency={loan.currency.code}
                            className="font-mono"
                          />
                        ),
                      })
                    ) : (
                      <>
                        <span className="font-mono" aria-hidden="true">
                          {effect === "up" ? "+" : "−"}
                        </span>
                        <span className="sr-only">
                          {effect === "up" ? t("increases") : t("decreases")}
                        </span>
                        <Amount
                          value={adjustment.amount}
                          currency={loan.currency.code}
                          className="font-mono"
                        />
                      </>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit")}
                    onClick={() => onEdit(adjustment)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete")}
                    disabled={remove.isPending}
                    onClick={() => void removeAdjustment(adjustment)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
