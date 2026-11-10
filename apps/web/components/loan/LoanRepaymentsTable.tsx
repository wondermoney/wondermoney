"use client";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/RuledSection";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type { LoanDetail, LoanRepayment } from "@/lib/api/loan/types";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

export default function LoanRepaymentsTable({
  loan,
  repayments,
  loading,
  onEditRepayment,
  onRemoveRepayment,
}: {
  loan: LoanDetail;
  repayments: LoanRepayment[];
  loading?: boolean;
  onEditRepayment: (repayment: LoanRepayment) => void;
  onRemoveRepayment: (repayment: LoanRepayment) => void;
}) {
  const t = useTranslations("loans");
  const formatShortDate = useFormatShortDate();
  const money = (value: number) => (
    <Amount value={value} currency={loan.currency.code} className="font-mono" />
  );

  return (
    // Linking a repayment lives in the page header; this section is the record.
    <Section id="loan-repayments-heading" title={t("detail.repayments.title")}>
      {/* Phone: each repayment restacks; the figures never scroll off-screen. */}
      <ul className="md:hidden">
        {loading ? (
          <li className="text-muted-foreground py-4 text-sm">
            {t("detail.loading")}
          </li>
        ) : repayments.length === 0 ? (
          <li className="text-muted-foreground py-4 text-sm">
            {t("detail.repayments.empty")}
          </li>
        ) : (
          repayments.map((repayment) => (
            <li
              key={repayment.loanRepaymentLinkKey}
              className="border-border flex items-start justify-between gap-3 border-b py-3"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-medium">
                  {repayment.accountName ??
                    repayment.transaction?.description ??
                    t("detail.unavailableAccount")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatShortDate(calendarDay(repayment.paymentDate))}
                  {", "}
                  {repayment.needsReview
                    ? t("detail.repayments.needsReview")
                    : t("detail.repayments.linked")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.rich("detail.repayments.split", {
                    principal: () => money(repayment.principalAmount),
                    interest: () => money(repayment.interestAmount),
                    fees: () => money(repayment.feeAmount),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm">
                  {money(repayment.totalPaymentAmount)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("detail.repayments.editAllocation")}
                    onClick={() => onEditRepayment(repayment)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("detail.repayments.removeAssociation")}
                    onClick={() => onRemoveRepayment(repayment)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <SimpleTable>
          <TableHeader className="bg-background [&_tr]:border-foreground [&_th]:text-xs">
            <TableRow>
              <TableHead className="pl-0 lg:pl-0">
                {t("detail.repayments.date")}
              </TableHead>
              <TableHead>{t("detail.repayments.transaction")}</TableHead>
              <TableHead className="text-right">
                {t("detail.repayments.payment")}
              </TableHead>
              <TableHead className="text-right">
                {t("detail.repayments.principal")}
              </TableHead>
              <TableHead className="text-right">
                {t("detail.repayments.interest")}
              </TableHead>
              <TableHead className="text-right">
                {t("detail.repayments.fees")}
              </TableHead>
              <TableHead>{t("detail.repayments.status")}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{t("table.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-6 text-sm"
                >
                  {t("detail.loading")}
                </TableCell>
              </TableRow>
            ) : repayments.length ? (
              repayments.map((repayment) => {
                // The API sends the linked bank transaction, not an account
                // name, so "account unavailable" printed on every row.
                const source =
                  repayment.accountName ??
                  repayment.transaction?.description ??
                  t("detail.unavailableAccount");
                return (
                  <TableRow key={repayment.loanRepaymentLinkKey}>
                    <TableCell className="pl-0 whitespace-nowrap lg:pl-0">
                      {formatShortDate(calendarDay(repayment.paymentDate))}
                    </TableCell>
                    <TableCell className="max-w-72">
                      <div className="text-foreground truncate">{source}</div>
                      {repayment.notes ? (
                        <div className="text-muted-foreground truncate text-xs">
                          {repayment.notes}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(repayment.totalPaymentAmount)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(repayment.principalAmount)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(repayment.interestAmount)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(repayment.feeAmount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {repayment.needsReview ? (
                        <span className="text-warning-text font-medium">
                          {t("detail.repayments.needsReview")}
                        </span>
                      ) : (
                        t("detail.repayments.linked")
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("detail.repayments.editAllocation")}
                          onClick={() => onEditRepayment(repayment)}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("detail.repayments.removeAssociation")}
                          onClick={() => onRemoveRepayment(repayment)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-6 text-sm"
                >
                  {t("detail.repayments.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </SimpleTable>
      </div>
    </Section>
  );
}
