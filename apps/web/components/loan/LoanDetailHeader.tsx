"use client";
import { Link2, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import type { LoanDetail } from "@/lib/api/loan/types";

/**
 * DESIGN.md § 9 — the loans detail route was the last one still carrying a
 * bespoke header.
 *
 * It titled the page with the loan's name and left the figure a person opened
 * the page to see — the outstanding principal — in a card below, third on the
 * page and boxed on its own. That is the exact pattern `ObjectHeader` exists to
 * remove: one header that says where you came from, what this is, its status,
 * and its key figure.
 *
 * The name stays the title rather than the amount taking its place. A loan you
 * reached by clicking "Car loan" has a name, and replacing it with a figure
 * would lose the thing confirming you are on the right page.
 */
export default function LoanDetailHeader({
  loan,
  summary,
  onLinkRepayments,
  onEdit,
}: {
  loan: LoanDetail;
  /** Same derived shape the summary cards take — computed once by the page. */
  summary?: { outstanding: number };
  onLinkRepayments: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("loans");

  return (
    <ObjectHeader
      backHref="/loans"
      backLabel={t("detail.actions.back")}
      title={loan.name}
      subtitle={loan.providerName ?? t("detail.providerUnavailable")}
      value={summary?.outstanding ?? loan.outstandingPrincipal ?? null}
      currency={loan.currency.code}
      valueLabel={t("summary.outstandingPrincipal")}
      actions={
        <>
          <Button onClick={onLinkRepayments}>
            <Link2 className="mr-2 size-4" />
            {t("actions.linkRepayment")}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Pencil className="mr-2 size-4" />
            {t("actions.edit")}
          </Button>
        </>
      }
    />
  );
}
