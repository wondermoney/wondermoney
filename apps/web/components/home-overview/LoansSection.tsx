"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { buttonVariants } from "@/components/ui/button";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import useLoans from "@/lib/api/loan/useLoans";
import { upcomingLoanPayments } from "@/lib/home/month-overview";
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

export function LoansSection({ className }: { className?: string }) {
  const t = useTranslations("homeOverview.loans");
  const formatShortDate = useFormatShortDate();
  const formatPercentage = useFormatPercentage();
  const today = useMemo(() => new Date(), []);
  const { data, isPending, error, refetch } = useLoans();

  if (isPending) {
    return (
      <Section id="loans-heading" title={t("title")} className={className} busy>
        <RowsSkeleton rows={3} />
      </Section>
    );
  }

  if (error) {
    return (
      <Section id="loans-heading" title={t("title")} className={className}>
        <DataLoadError error={error} onRetry={() => void refetch()} />
      </Section>
    );
  }

  const payments = upcomingLoanPayments(data.loans, today);

  return (
    <Section id="loans-heading" title={t("title")} className={className}>
      {payments.length === 0 ? (
        <SectionEmpty
          title={
            data.loans.length === 0 ? t("empty-title") : t("none-due-title")
          }
          body={data.loans.length === 0 ? t("empty-body") : t("none-due-body")}
          action={
            <Link
              href="/loans"
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("action")}
            </Link>
          }
        />
      ) : (
        <ul>
          {payments.map((loan) => (
            <li
              key={loan.loanKey}
              className="border-border grid grid-cols-[4rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b py-3"
            >
              <span className="text-foreground text-sm font-semibold">
                {formatShortDate(calendarDay(loan.nextPaymentDate ?? ""))}
              </span>
              <Link
                href={`/loans/${loan.loanKey}`}
                className={cn(
                  "text-foreground truncate text-sm font-medium hover:underline",
                )}
              >
                {loan.name}
              </Link>
              <Amount
                value={loan.regularPaymentAmount}
                currency={loan.currency.code}
                className="font-mono text-sm"
              />
              <span className="text-muted-foreground col-start-2 col-end-4 text-sm">
                {t.rich("outstanding", {
                  amount: () => (
                    <Amount
                      value={loan.outstandingPrincipal}
                      currency={loan.currency.code}
                      className="font-mono"
                    />
                  ),
                })}
                {typeof loan.annualInterestRateBps === "number"
                  ? ` ${t("rate", {
                      rate: formatPercentage(
                        loan.annualInterestRateBps / 10000,
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        },
                      ),
                    })}`
                  : null}
                {loan.providerName ? `, ${loan.providerName}` : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
