import type { EntityManager } from '@mikro-orm/core';

import { type CurrencyPair, loadRateTable, type RateScope, type RateTable } from '@service/currency/exchange-rate';
import { Money } from '@utils/money';

/**
 * An account's current balance as each household member sees it.
 *
 * `Account.appuserCurrencyBalance` is in the account *owner's* currency, and household members
 * each pick their own. So it can only be read as-is by a viewer who shares the owner's currency;
 * for anyone else the balance is taken in the account's own currency and converted at the latest
 * rate.
 */
export interface ConvertibleAccount {
  accountOwnerAppuserKey?: null | { currencyKey?: null | { code?: string } };
  appuserCurrencyBalance?: null | number;
  balance?: null | number;
  currencyKey?: null | { code?: string };
}

/** The relations {@link accountBalanceIn} reads; populate them on the accounts first. */
export const ACCOUNT_BALANCE_POPULATE = ['currencyKey', 'accountOwnerAppuserKey.currencyKey'] as const;

/** The balance in `viewerCurrency`, or null when no rate converts it. */
export function accountBalanceIn(account: ConvertibleAccount, viewerCurrency: string, rates: RateTable, date: Date): Money | null {
  const ownerCurrency = ownerCurrencyOf(account);
  if (ownerCurrency === viewerCurrency && account.appuserCurrencyBalance != null) return Money.of(account.appuserCurrencyBalance, viewerCurrency);
  const accountCurrency = account.currencyKey?.code;
  // A balance stored as `missing` (no rate when it was written) is converted again here from the
  // account's own currency; with no balance or no rate it is left out, never counted as zero.
  if (account.balance == null || !accountCurrency) return null;
  const rate = rates.rateOn(accountCurrency, viewerCurrency, date);
  if (rate == null) return null;
  return Money.convert(Money.of(account.balance, accountCurrency), { rate, to: viewerCurrency });
}

/** Load the rates {@link accountBalanceIn} needs for these accounts on `date`, with the household's overrides. */
export async function loadAccountRates(em: EntityManager, accounts: ConvertibleAccount[], viewerCurrency: string, date: Date, scope: RateScope): Promise<RateTable> {
  const pairs: CurrencyPair[] = [];
  for (const account of accounts) {
    const accountCurrency = account.currencyKey?.code;
    if (!accountCurrency) continue;
    if (ownerCurrencyOf(account) === viewerCurrency && account.appuserCurrencyBalance != null) continue;
    pairs.push({ from: accountCurrency, to: viewerCurrency });
  }
  return loadRateTable(em, pairs, { from: date, to: date }, scope);
}

function ownerCurrencyOf(account: ConvertibleAccount): string | undefined {
  return account.accountOwnerAppuserKey?.currencyKey?.code;
}
