"use client";
import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LoanRepaymentCandidate } from "@/lib/api/loan/types";
export default function RepaymentCandidateList({
  candidates,
  loading,
  onSelect,
}: {
  candidates: LoanRepaymentCandidate[];
  loading?: boolean;
  onSelect: (transactionKey: number) => void;
}) {
  const t = useTranslations("loans");
  if (loading)
    return (
      <div className="text-muted-foreground text-sm">{t("detail.loading")}</div>
    );
  if (!candidates.length)
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          {t("detail.repayments.noCandidates")}
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <Card key={candidate.transactionKey}>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="space-y-1">
              <div className="font-medium">
                {candidate.description ??
                  candidate.merchantName ??
                  t("detail.na")}
              </div>
              <div className="text-muted-foreground text-sm">
                {candidate.accountName ?? t("detail.unavailableAccount")}
              </div>
              <div className="text-muted-foreground text-sm">
                {candidate.bookingDate ?? candidate.valueDate ?? t("detail.na")}
              </div>
              <div className="text-muted-foreground text-xs">
                {t("detail.repayments.candidateConfidence", {
                  value:
                    candidate.confidence != null
                      ? t("detail.repayments.confidenceValue", {
                          value: candidate.confidence,
                        })
                      : t("detail.repayments.confidenceUnavailable"),
                })}
              </div>
              <div className="text-muted-foreground text-xs">
                {candidate.reasons?.length
                  ? candidate.reasons.join(" · ")
                  : t("detail.repayments.reasonsUnavailable")}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono">
                <Amount
                  value={candidate.amount}
                  currency={candidate.currencyCode}
                />
              </div>
              <Button
                className="mt-2"
                onClick={() => onSelect(candidate.transactionKey)}
              >
                <Link2 className="mr-2 size-4" />
                {t("actions.linkRepayment")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
