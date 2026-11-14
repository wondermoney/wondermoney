"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Amount } from "@/components/ui/Amount";
import { Section } from "@/components/ui/RuledSection";
import { Link } from "@/i18n/navigation";
import type { LoanDetail } from "@/lib/api/loan/types";
import {
  LOAN_STATUS_LABEL_KEY,
  LOAN_TYPE_LABEL_KEY,
} from "@/lib/loans/loan-labels";

export default function LoanAssumptionsCard({
  loan,
  action,
}: {
  loan: LoanDetail;
  action?: ReactNode;
}) {
  const t = useTranslations("loans");
  const securedAsset = loan.securedAsset;
  const rows: Array<readonly [string, ReactNode]> = [
    // The lender always printed "provider unavailable", even with the
    // provider's name on the loan (and in the header above it).
    [t("fields.lender"), loan.providerName || t("detail.providerUnavailable")],
    [t("fields.type"), t(`types.${LOAN_TYPE_LABEL_KEY[loan.type] ?? "other"}`)],
    [
      t("fields.status"),
      t(`statuses.${LOAN_STATUS_LABEL_KEY[loan.status] ?? "active"}`),
    ],
    // The asset it pays for, with what that is worth today; its page shows the equity.
    ...(securedAsset
      ? [
          [
            t("fields.securedAsset"),
            <span key="secured-asset" className="flex flex-col items-end">
              <Link
                href={`/assets/${securedAsset.key}`}
                className="text-primary font-medium underline-offset-4 hover:underline focus-visible:underline"
              >
                {securedAsset.name}
              </Link>
              {securedAsset.value !== null ? (
                <Amount
                  value={securedAsset.value}
                  currency={securedAsset.currency}
                  className="font-mono"
                />
              ) : null}
            </span>,
          ] as const,
        ]
      : []),
    [t("detail.description"), loan.description ?? loan.notes ?? t("detail.na")],
  ];
  return (
    <Section
      id="loan-assumptions-heading"
      title={t("detail.assumptions.title")}
    >
      <dl>
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="border-border flex items-start justify-between gap-4 border-b py-2.5 text-sm"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {action ? <div className="mt-4">{action}</div> : null}
    </Section>
  );
}
