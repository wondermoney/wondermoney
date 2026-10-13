"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { cn } from "@/lib/utils";

interface AccountsTransactionsEmptyStateProps {
  onAddAccount: () => void;
  onAddTransaction: () => void;
  noAccounts?: boolean;
}

const sampleTransactions = [
  {
    date: "Feb 14, 2026",
    account: "Main Checking",
    description: "Supermarket",
    merchant: "Whole Foods",
    category: "Groceries",
    amount: "-€85.40",
    balance: "€2,364.60",
    isExpense: true,
  },
  {
    date: "Feb 12, 2026",
    account: "Savings",
    description: "Monthly Transfer",
    merchant: "—",
    category: "Savings",
    amount: "+€500.00",
    balance: "€8,500.00",
    isExpense: false,
  },
  {
    date: "Feb 08, 2026",
    account: "Main Checking",
    description: "Coffee Shop",
    merchant: "Starbucks",
    category: "Dining",
    amount: "-€4.50",
    balance: "€2,450.00",
    isExpense: true,
  },
  {
    date: "Feb 03, 2026",
    account: "Main Checking",
    description: "Salary Payment",
    merchant: "—",
    category: "Income",
    amount: "+€3,200.00",
    balance: "€2,454.50",
    isExpense: false,
  },
];

const AccountsTransactionsEmptyState: React.FC<
  AccountsTransactionsEmptyStateProps
> = ({ onAddAccount, onAddTransaction, noAccounts = false }) => {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("transactions")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {noAccounts
              ? t("accounts-transactions-no-account-description")
              : t("accounts-transactions-empty-description")}
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {t("transactions")}
          </span>
          <PreviewBadge />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("date")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("account")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("description")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("merchant")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  {t("category")}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  {t("amount")}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  {t("balance")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sampleTransactions.map((tx, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tx.date}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {tx.account}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">
                    {tx.description}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tx.merchant}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tx.category}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-mono text-xs font-medium",
                      tx.isExpense ? "text-destructive-text" : "text-success-text",
                    )}
                  >
                    {tx.amount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {tx.balance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CTA */}
      <div>
        <Button
          className="gap-2"
          onClick={noAccounts ? onAddAccount : onAddTransaction}
        >
          <Plus className="size-4" />
          {noAccounts
            ? t("add-first-account")
            : t("accounts-transactions-empty-add-first")}
        </Button>
      </div>
    </div>
  );
};

export default AccountsTransactionsEmptyState;
