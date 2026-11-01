"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { formatTxDate } from "@/lib/account/accounts-formatters";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

export default function TransactionsList({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  // Show at most 8 recent transactions
  const recentTxs = transactions.slice(0, 8);

  return (
    <div className="divide-border divide-y">
      {recentTxs.map((tx) => {
        const amount = tx.appuserSettlementAmount ?? tx.settlementAmount;
        const currency =
          tx.appuserCurrencyKey?.code ?? tx.settlementCurrencyKey.code;
        const category = tx.appuserTransactionCategories?.[0];

        return (
          <div
            key={tx.transactionKey}
            className="flex items-center justify-between px-5 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                {category ? (
                  <CategoryIcon
                    icon={category.icon}
                    category={!category.icon ? category.name : undefined}
                    width="16px"
                    height="16px"
                    className="text-muted-foreground"
                  />
                ) : (
                  <Wallet className="text-muted-foreground h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm">
                  {tx.transactionMerchantKey?.name || tx.description}
                </p>
                <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  <span>{formatTxDate(tx.transactionDate)}</span>
                  {category && (
                    <>
                      <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />
                      <span>{t(getCategoryTranslationKey(category.name))}</span>
                    </>
                  )}
                  <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />
                  <span className="min-w-0 truncate">
                    {tx.accountKey.accountName}
                  </span>
                </div>
              </div>
            </div>
            <span className="text-foreground shrink-0 font-mono text-sm">
              <Amount value={amount} currency={currency} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
