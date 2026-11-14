"use client";

import { CalendarClock, CreditCard, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Section } from "@/components/ui/RuledSection";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import type { CreditCardSettings } from "@/lib/api/account/useAccounts";
import useCreditCardStatements, {
  type CreditCardStatement,
} from "@/lib/api/account/useCreditCardStatements";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

function formatStatementDate(value: string, locale: string): string {
  // The API sends a calendar day; noon UTC keeps it on the same day in every timezone.
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

/**
 * The current credit-card statement on an account's page: what it charges, when it is due and how
 * much of the limit is still free. Renders nothing for an account that is not a card.
 */
export default function CreditCardStatementSummary({
  accountKey,
  creditCard,
  currency,
}: {
  accountKey: number;
  creditCard: CreditCardSettings | null | undefined;
  currency: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const { data, isLoading } = useCreditCardStatements(
    { accountKey },
    { enabled: Boolean(creditCard) },
  );

  const current: CreditCardStatement | null = useMemo(() => {
    const statements = data?.statements ?? [];
    return statements.find((statement) => statement.isCurrent) ?? statements.at(-1) ?? null;
  }, [data?.statements]);

  if (!creditCard) return null;

  return (
    <Section id="credit-card-statement-heading" title={t("credit-card-statement")}>
      {isLoading && !current ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : current ? (
        <StatCardGrid>
          <StatCard
            icon={CreditCard}
            label={t("credit-card-statement-balance")}
            value={current.balance}
            currency={currency}
            helper={t("credit-card-statement-period", {
              start: formatStatementDate(current.periodStart, locale),
              end: formatStatementDate(current.periodEnd, locale),
            })}
          />
          <StatCard
            icon={CalendarClock}
            label={t("credit-card-due-date")}
            valueNode={formatStatementDate(current.dueDate, locale)}
            helper={t("credit-card-due-date-description")}
          />
          <StatCard
            icon={Wallet}
            label={t("credit-card-available-credit")}
            value={current.availableCredit}
            currency={currency}
            helper={
              creditCard.creditLimit === null
                ? t("credit-card-limit-not-set")
                : t("credit-card-limit-of", {
                    limit: formatCurrency(creditCard.creditLimit, currency),
                  })
            }
          />
        </StatCardGrid>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("credit-card-no-statement")}
        </p>
      )}
    </Section>
  );
}
