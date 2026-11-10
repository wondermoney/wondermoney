"use client";

import { Briefcase, ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AccountMark } from "@/components/account/AccountMark";
import { Amount } from "@/components/ui/Amount";
import DataLoadError from "@/components/ui/DataLoadError";
import { RowsSkeleton, Section } from "@/components/ui/RuledSection";
import useAccounts from "@/lib/api/account/useAccounts";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import {
  balanceSheet,
  type BalanceSheetGroup,
  type BalanceSheetRow,
  type BalanceSheetType,
} from "@/lib/home/month-overview";

import { PortfolioLinkSuggestion } from "./PortfolioLinkSuggestion";

type MarkFor = (type: BalanceSheetType, row: BalanceSheetRow) => ReactNode;
/** The name of the account a portfolio row is already counted in. */
type CountedInName = (accountKey: number) => string | undefined;

function Side({
  id,
  title,
  groups,
  total,
  currency,
  markFor,
  countedInName,
}: {
  id: string;
  title: string;
  groups: BalanceSheetGroup[];
  total: number;
  currency: string;
  markFor: MarkFor;
  countedInName: CountedInName;
}) {
  const t = useTranslations("homeOverview.sheet");

  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="text-foreground mb-2 text-base font-semibold">
        {title}
      </h3>
      {groups.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{t("side-empty")}</p>
      ) : (
        groups.map((group) => (
          <div key={group.type}>
            <h4 className="text-muted-foreground mt-4 mb-1 text-sm font-medium">
              {t(`groups.${group.type}`)}
            </h4>
            <dl>
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  className="border-border flex justify-between gap-4 border-b py-2 text-sm"
                >
                  <dt className="flex min-w-0 items-center gap-3">
                    {markFor(group.type, row)}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{row.label}</span>
                      {row.countedInAccountId !== undefined ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {t("counted-in", {
                            account:
                              countedInName(row.countedInAccountId) ?? "",
                          })}
                        </span>
                      ) : null}
                    </span>
                  </dt>
                  <dd>
                    {/* Already inside the account's balance: shown, not added. */}
                    <Amount
                      value={row.amount}
                      currency={currency}
                      className={
                        row.countedInAccountId !== undefined
                          ? "text-muted-foreground font-mono"
                          : "font-mono"
                      }
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
      <dl>
        <div className="flex justify-between gap-4 pt-3 text-sm font-semibold">
          <dt>{t("total")}</dt>
          <dd>
            <Amount value={total} currency={currency} className="font-mono" />
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * What makes up net worth: each side of the balance sheet itemised by kind,
 * with its total. The hero above carries the two totals and the net figure.
 */
export function BalanceSheetSection() {
  const t = useTranslations("homeOverview.sheet");
  const { data, isPending, error, refetch } = useNetWorth();
  const { data: accountsData } = useAccounts();

  if (isPending) {
    return (
      <Section id="sheet-heading" title={t("title")} busy>
        <RowsSkeleton rows={6} />
      </Section>
    );
  }

  if (error) {
    return (
      <Section id="sheet-heading" title={t("title")}>
        <DataLoadError error={error} onRetry={() => void refetch()} />
      </Section>
    );
  }

  const netWorth = data.netWorth;
  const currency = netWorth.currencyCode ?? "EUR";
  const sheet = balanceSheet(netWorth);
  const accountsByKey = new Map(
    (accountsData?.accounts ?? []).map((account) => [
      account.accountKey,
      account,
    ]),
  );
  // Each row's mark: the bank's logo for an account (a wallet without one),
  // a briefcase for a portfolio and a receipt for a loan.
  const markFor: MarkFor = (type, row) => {
    const account =
      type === "accounts" && row.recordId !== undefined
        ? accountsByKey.get(row.recordId)
        : undefined;
    return (
      <AccountMark
        className="size-6 rounded-md"
        logoUrl={account?.accountFinancialInstitutionKey?.logoUrl}
        label={
          account?.accountFinancialInstitutionKey?.displayName ?? row.label
        }
        fallbackIcon={
          type === "portfolios"
            ? Briefcase
            : type === "loans"
              ? ReceiptText
              : undefined
        }
      />
    );
  };

  const countedInName: CountedInName = (accountKey) =>
    netWorth.rows?.find(
      (row) => row.key.startsWith("accounts:") && row.recordId === accountKey,
    )?.label;

  // The net worth hero carries the empty state and its action.
  if (sheet.own.length === 0 && sheet.owe.length === 0) return null;

  return (
    <Section id="sheet-heading" title={t("title")}>
      <PortfolioLinkSuggestion
        suggested={netWorth.suggestPortfolioLink === true}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="sm:pr-6">
          <Side
            id="sheet-own"
            title={t("own")}
            groups={sheet.own}
            total={sheet.ownTotal}
            currency={currency}
            markFor={markFor}
            countedInName={countedInName}
          />
        </div>
        <div className="border-foreground mt-6 border-t pt-4 sm:mt-0 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          <Side
            id="sheet-owe"
            title={t("owe")}
            groups={sheet.owe}
            total={sheet.oweTotal}
            currency={currency}
            markFor={markFor}
            countedInName={countedInName}
          />
        </div>
      </div>
    </Section>
  );
}
