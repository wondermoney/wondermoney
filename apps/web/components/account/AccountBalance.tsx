"use client";

import { Amount } from "@/components/ui/Amount";
import { FxStatusBadge } from "@/components/ui/FxStatusBadge";
import type { Account } from "@/lib/api/account/useAccounts";
import { accountFxView } from "@/lib/fx/fx-status";
import { cn } from "@/lib/utils";

type BalanceAccount = Pick<
  Account,
  | "accountOwnerAppuserKey"
  | "appuserCurrencyBalance"
  | "balance"
  | "currencyKey"
  | "fxRateDate"
  | "fxStatus"
>;

/**
 * The balance an account row shows: in its owner's currency, or, when no
 * exchange rate converts it, in the account's own currency.
 */
export function accountDisplayBalance(account: BalanceAccount): {
  value: number | null;
  currency: string;
} {
  if (accountFxView(account).status === "missing") {
    return { value: account.balance, currency: account.currencyKey.code };
  }
  return {
    value: account.appuserCurrencyBalance,
    currency: account.accountOwnerAppuserKey.currencyKey.code,
  };
}

/** The names of the currencies whose accounts have no converted balance. */
export function unconvertedAccountCurrencies(
  accounts: BalanceAccount[],
): string[] {
  const currencies = accounts
    .filter((account) => accountFxView(account).status === "missing")
    .map((account) => account.currencyKey.code);
  return [...new Set(currencies)].sort();
}

/**
 * An account's balance with how it was converted: "Not converted" beside a
 * balance in the account's own currency, "Estimated" beside one converted at
 * an old rate. `className` styles the figure.
 */
export function AccountBalance({
  account,
  className,
}: {
  account: BalanceAccount;
  className?: string;
}) {
  const { value, currency } = accountDisplayBalance(account);

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <FxStatusBadge
        view={accountFxView(account)}
        originalCurrency={account.currencyKey.code}
      />
      <Amount value={value} currency={currency} className={cn(className)} />
    </span>
  );
}
