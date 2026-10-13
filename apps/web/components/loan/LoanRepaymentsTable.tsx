"use client";
import { Pencil, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type { LoanDetail, LoanRepayment } from "@/lib/api/loan/types";

export default function LoanRepaymentsTable({
  loan,
  repayments,
  loading,
  onLinkRepayment,
  onEditRepayment,
  onRemoveRepayment,
}: {
  loan: LoanDetail;
  repayments: LoanRepayment[];
  loading?: boolean;
  onLinkRepayment: () => void;
  onEditRepayment: (repayment: LoanRepayment) => void;
  onRemoveRepayment: (repayment: LoanRepayment) => void;
}) {
  const t = useTranslations("loans");
  const locale = useLocale();
  return (
    // § 9 observation 4: the table sits on the canvas, not inside a padded card.
    // § 9 observation 3: the section is titled and nothing else — the
    // supporting sentence is gone and the table starts immediately.
    <section>
      <div>
        <div className="flex items-center justify-between pb-3">
          <h2 className="font-semibold">{t("detail.repayments.title")}</h2>
          <Button onClick={onLinkRepayment}>
            {t("actions.linkRepayment")}
          </Button>
        </div>
        <div className="border-border overflow-x-auto border-y">
          <SimpleTable>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.repayments.date")}</TableHead>
                <TableHead>{t("detail.repayments.account")}</TableHead>
                <TableHead>{t("detail.repayments.description")}</TableHead>
                <TableHead>{t("detail.repayments.payment")}</TableHead>
                <TableHead>{t("detail.repayments.principal")}</TableHead>
                <TableHead>{t("detail.repayments.interest")}</TableHead>
                <TableHead>{t("detail.repayments.fees")}</TableHead>
                <TableHead>{t("detail.repayments.status")}</TableHead>
                <TableHead className="text-right">
                  {t("table.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-muted-foreground p-6 text-center text-sm"
                  >
                    {t("detail.loading")}
                  </TableCell>
                </TableRow>
              ) : repayments.length ? (
                repayments.map((repayment) => (
                  <TableRow key={repayment.loanRepaymentLinkKey}>
                    <TableCell>
                      {new Date(repayment.paymentDate).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell>
                      {repayment.accountName ?? t("detail.unavailableAccount")}
                    </TableCell>
                    <TableCell>{repayment.notes ?? t("detail.na")}</TableCell>
                    <TableCell className="font-mono">
                      <Amount
                        value={repayment.totalPaymentAmount}
                        currency={loan.currency.code}
                      />
                    </TableCell>
                    <TableCell className="font-mono">
                      <Amount
                        value={repayment.principalAmount}
                        currency={loan.currency.code}
                      />
                    </TableCell>
                    <TableCell className="font-mono">
                      <Amount
                        value={repayment.interestAmount}
                        currency={loan.currency.code}
                      />
                    </TableCell>
                    <TableCell className="font-mono">
                      <Amount
                        value={repayment.feeAmount}
                        currency={loan.currency.code}
                      />
                    </TableCell>
                    <TableCell>
                      {repayment.needsReview
                        ? t("detail.repayments.needsReview")
                        : t("detail.repayments.linked")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("detail.repayments.editAllocation")}
                          onClick={() => onEditRepayment(repayment)}
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">
                            {t("detail.repayments.editAllocation")}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("detail.repayments.removeAssociation")}
                          onClick={() => onRemoveRepayment(repayment)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">
                            {t("detail.repayments.removeAssociation")}
                          </span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-muted-foreground p-6 text-center text-sm"
                  >
                    {t("detail.repayments.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </SimpleTable>
        </div>
      </div>
    </section>
  );
}
