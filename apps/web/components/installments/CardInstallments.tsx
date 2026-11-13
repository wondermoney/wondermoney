"use client";

import { CalendarClock, ChevronRight, Layers, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/RuledSection";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import type { Category } from "@/lib/api/category/useCategories";
import type {
  InstallmentPlan,
  InstallmentSuggestion,
} from "@/lib/api/installment-plans/types";
import useInstallmentPlans, {
  useInstallmentCommitments,
  useInstallmentSuggestions,
} from "@/lib/api/installment-plans/useInstallmentPlans";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { installmentPlanHref } from "./InstallmentBadge";
import InstallmentPlanFormDialog, {
  type InstallmentPlanDraft,
} from "./InstallmentPlanFormDialog";
import { useFormatPlanDay } from "./useFormatPlanDay";

/** A detected suggestion as the create form's starting point, with its rows to link. */
export function suggestionDraft(
  suggestion: InstallmentSuggestion,
): InstallmentPlanDraft {
  return {
    description: suggestion.description,
    purchaseDate: suggestion.purchaseDate,
    totalAmount: suggestion.totalAmount,
    installmentCount: suggestion.installmentCount,
    links: suggestion.transactions.map((transaction) => ({
      transactionKey: transaction.transactionKey,
      installmentNumber: transaction.installmentNumber,
    })),
  };
}

/**
 * A credit card's installment purchases on its page: what is still to be charged, the card's
 * plans (each opening its schedule), and the rows that look like a purchase in installments.
 * Upcoming installments are projections only, so nothing here moves the card's balance.
 * On a card shared to view only (`readOnly`) the plans show but none can be created.
 */
export default function CardInstallments({
  accountKey,
  currency,
  categories,
  readOnly = false,
}: {
  accountKey: number;
  currency: string;
  categories: Category[];
  readOnly?: boolean;
}) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const formatCurrency = useFormatCurrency();
  const plansQuery = useInstallmentPlans(accountKey);
  const commitmentsQuery = useInstallmentCommitments(accountKey);
  const suggestionsQuery = useInstallmentSuggestions(accountKey);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<InstallmentPlanDraft | undefined>();

  const plans = plansQuery.data?.installmentPlans ?? [];
  const suggestions = suggestionsQuery.data?.suggestions ?? [];
  const commitment =
    commitmentsQuery.data?.commitments.find(
      (candidate) => candidate.accountKey === accountKey,
    ) ?? null;

  const openForm = (next?: InstallmentPlanDraft) => {
    setDraft(next);
    setFormOpen(true);
  };

  const isLoading = plansQuery.isLoading && !plansQuery.data;

  return (
    <Section
      id="card-installments-heading"
      title={t("installments.title")}
      busy={isLoading}
      aside={
        readOnly ? undefined : (
          <Button variant="secondary" size="sm" onClick={() => openForm()}>
            <Plus className="size-4" aria-hidden="true" />
            {t("installments.new-plan")}
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {plans.length > 0 ? (
            <div className="flex flex-col gap-3">
              <StatCardGrid className="sm:grid-cols-2">
                <StatCard
                  icon={Layers}
                  label={t("installments.remaining-commitment")}
                  value={commitment?.remainingAmount ?? 0}
                  currency={commitment?.currency ?? currency}
                  helper={
                    commitment && commitment.remainingCount > 0
                      ? t("installments.remaining-commitment-helper", {
                          count: commitment.remainingCount,
                          plans: commitment.activePlanCount,
                        })
                      : t("installments.remaining-commitment-none")
                  }
                />
                <StatCard
                  icon={CalendarClock}
                  label={t("installments.next-installment")}
                  value={commitment?.nextInstallment?.amount ?? null}
                  currency={commitment?.currency ?? currency}
                  helper={
                    commitment?.nextInstallment
                      ? `${formatPlanDay(commitment.nextInstallment.date)} · ${t(
                          "installments.next-installment-helper",
                          {
                            description: commitment.nextInstallment.description,
                            number:
                              commitment.nextInstallment.installmentNumber,
                            count: commitment.nextInstallment.installmentCount,
                          },
                        )}`
                      : undefined
                  }
                />
              </StatCardGrid>
              <p className="text-muted-foreground text-xs">
                {t("installments.projections-note")}
              </p>
            </div>
          ) : null}

          {plans.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-foreground text-sm font-semibold">
                {t("installments.plans")}
              </h3>
              <ul className="border-border divide-border divide-y border-y">
                {plans.map((plan) => (
                  <PlanRow key={plan.installmentPlanKey} plan={plan} />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("installments.no-plans")}
            </p>
          )}

          {suggestions.length > 0 && !readOnly ? (
            <section
              aria-labelledby="installment-suggestions-heading"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <h3
                  id="installment-suggestions-heading"
                  className="text-foreground text-sm font-semibold"
                >
                  {t("installments.suggestions-title")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t("installments.suggestions-description")}
                </p>
              </div>
              <ul className="border-border divide-border divide-y rounded-lg border border-dashed">
                {suggestions.map((suggestion) => (
                  <li
                    key={suggestion.key}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-medium">
                        {suggestion.description}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs tabular-nums">
                        {t("installments.suggestion-summary", {
                          count: suggestion.installmentCount,
                          amount: formatCurrency(
                            suggestion.installmentAmount,
                            suggestion.currency,
                          ),
                          total: formatCurrency(
                            suggestion.totalAmount,
                            suggestion.currency,
                          ),
                        })}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t("installments.suggestion-found", {
                          count: suggestion.transactions.length,
                        })}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openForm(suggestionDraft(suggestion))}
                    >
                      {t("installments.create-plan")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <InstallmentPlanFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={{ kind: "create", accountKey, currency, draft }}
        categories={categories}
      />
    </Section>
  );
}

function PlanRow({ plan }: { plan: InstallmentPlan }) {
  const t = useTranslations();
  const formatPlanDay = useFormatPlanDay();
  const next = plan.nextInstallment;

  return (
    <li>
      <Link
        href={installmentPlanHref(plan.installmentPlanKey)}
        className="hover:bg-muted/50 focus-visible:ring-ring flex min-h-14 items-center justify-between gap-3 px-1 py-3 no-underline focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground truncate text-sm font-medium">
            {plan.description}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("installments.plan-progress", {
              paid: plan.paidCount,
              count: plan.installmentCount,
            })}
            {" · "}
            {next
              ? t("installments.plan-next", {
                  date: formatPlanDay(next.scheduledDate),
                })
              : t("installments.plan-finished")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex flex-col items-end">
            <Amount
              value={plan.remainingAmount}
              currency={plan.currency}
              className="text-foreground text-sm"
            />
            <span className="text-muted-foreground text-xs">
              {t("installments.plan-remaining")}
            </span>
          </span>
          <ChevronRight
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
        </span>
      </Link>
    </li>
  );
}
