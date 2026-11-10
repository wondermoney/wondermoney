import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { accountAppuserTail, chainAppuserAmount, storedAppuserBalance } from '@service/transaction/balance-chain.service';
import { addMoney, subtractMoney, sumMoney } from '@utils/money';

/*
 * The user-currency running balance follows the balance chain's rule (`chainAppuserAmount`): a row
 * with no converted amount makes it unknown (null) from there on. It is never carried on by adding
 * the row's amount in the account's currency.
 */
type MaybeAmount = null | number;
const plus = (total: MaybeAmount, amount: MaybeAmount | undefined): MaybeAmount => (total == null || amount == null ? null : addMoney(total, amount));
const minus = (total: MaybeAmount, amount: MaybeAmount | undefined): MaybeAmount => (total == null || amount == null ? null : subtractMoney(total, amount));

export interface AccountCsvBalancePlan {
  accountAppuserBalance?: MaybeAmount;
  accountBalance: number;
  items: AccountCsvBalancePlanItem[];
  /**
   * The balance before the account's oldest row once the plan is applied, in the account
   * currency: the account's opening balance. An import that back-derives older rows moves it.
   * Undefined when the account has no rows or the oldest carries no balance.
   */
  openingBalance?: number;
}

export interface AccountCsvBalancePlanItem {
  appuserBalance?: MaybeAmount;
  balance: number;
  imported: boolean;
  transaction: Transaction;
}

class AccountCsvBalanceRecalculationService {
  planBankBalances(account: Account, existingTransactions: Transaction[], importedTransactions: Transaction[]): AccountCsvBalancePlan {
    const plan = this.planChain(account, existingTransactions, importedTransactions);
    return { ...plan, openingBalance: openingBalanceOf([...existingTransactions, ...importedTransactions]) };
  }

  private planChain(account: Account, existingTransactions: Transaction[], importedTransactions: Transaction[]): Omit<AccountCsvBalancePlan, 'openingBalance'> {
    const existing = [...existingTransactions].sort(sortByDateThenKey);
    const imported = [...importedTransactions].sort(sortByDateThenKey);
    const currentBalance = account.balance ?? 0;
    const currentAppuserBalance = accountAppuserTail(account);
    if (imported.length === 0) return { accountAppuserBalance: currentAppuserBalance, accountBalance: currentBalance, items: [] };

    const firstImported = imported[0];
    const lastImported = imported.at(-1);
    if (!firstImported || !lastImported) return { accountAppuserBalance: currentAppuserBalance, accountBalance: currentBalance, items: [] };
    const earliestImported = firstImported.transactionDate?.getTime() ?? 0;
    const latestImported = lastImported.transactionDate?.getTime() ?? 0;
    const earliestExisting = existing[0]?.transactionDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const latestExisting = existing.at(-1)?.transactionDate?.getTime() ?? Number.NEGATIVE_INFINITY;

    if (existing.length === 0) return this.planEmptyAccount(account, imported);

    if (earliestImported > latestExisting) {
      return this.planNewerImports(account, existing, imported);
    }

    if (latestImported < earliestExisting) {
      return this.planOlderOnlyImports(account, existing, imported);
    }

    return this.planMixedImports(account, existing, imported);
  }

  private planEmptyAccount(account: Account, imported: Transaction[]): AccountCsvBalancePlan {
    const currentBalance = account.balance ?? 0;
    const currentAppuserBalance = accountAppuserTail(account);
    let forward = subtractMoney(currentBalance, sumMoney(imported.map((tx) => tx.settlementAmount)));
    const importedAppuser = imported.map((tx) => chainAppuserAmount(tx));
    let forwardAppuser: MaybeAmount = importedAppuser.some((amount) => amount == null) ? null : minus(currentAppuserBalance, sumMoney(importedAppuser));
    const items: AccountCsvBalancePlanItem[] = [];
    for (const tx of imported) {
      forward += tx.settlementAmount ?? 0;
      forwardAppuser = plus(forwardAppuser, chainAppuserAmount(tx));
      tx.balance = forward;
      tx.appuserCurrencyBalance = forwardAppuser;
      items.push({ appuserBalance: forwardAppuser, balance: forward, imported: true, transaction: tx });
    }
    return { accountAppuserBalance: currentAppuserBalance, accountBalance: currentBalance, items };
  }

  private planMixedImports(account: Account, existing: Transaction[], imported: Transaction[]): AccountCsvBalancePlan {
    const items: AccountCsvBalancePlanItem[] = [];
    const firstExisting = existing[0];
    if (!firstExisting) return this.planEmptyAccount(account, imported);
    const firstExistingTime = firstExisting.transactionDate?.getTime() ?? 0;
    const preAnchor = (firstExisting.balance ?? account.balance ?? 0) - (firstExisting.settlementAmount ?? 0);
    const preAnchorAppuser = minus(storedAppuserBalance(firstExisting, accountAppuserTail(account)), chainAppuserAmount(firstExisting));
    let running = preAnchor;
    let runningAppuser = preAnchorAppuser;

    const olderImported = imported.filter((tx) => (tx.transactionDate?.getTime() ?? 0) < firstExistingTime).sort((a, b) => sortByDateThenKey(b, a));
    for (const tx of olderImported) {
      tx.balance = running;
      tx.appuserCurrencyBalance = runningAppuser;
      items.unshift({ appuserBalance: runningAppuser, balance: running, imported: true, transaction: tx });
      running -= tx.settlementAmount ?? 0;
      runningAppuser = minus(runningAppuser, chainAppuserAmount(tx));
    }

    const forwardEntries = [...existing.map((tx) => ({ kind: 'existing' as const, tx })), ...imported.map((tx) => ({ kind: 'imported' as const, tx }))]
      .filter((entry) => (entry.tx.transactionDate?.getTime() ?? 0) >= firstExistingTime)
      .sort((a, b) => sortByDateThenKey(a.tx, b.tx));
    running = preAnchor;
    runningAppuser = preAnchorAppuser;
    for (const entry of forwardEntries) {
      running += entry.tx.settlementAmount ?? 0;
      runningAppuser = plus(runningAppuser, chainAppuserAmount(entry.tx));
      entry.tx.balance = running;
      entry.tx.appuserCurrencyBalance = runningAppuser;
      items.push({ appuserBalance: runningAppuser, balance: running, imported: entry.kind === 'imported', transaction: entry.tx });
    }
    return { accountAppuserBalance: runningAppuser, accountBalance: running, items };
  }

  private planNewerImports(account: Account, existing: Transaction[], imported: Transaction[]): AccountCsvBalancePlan {
    const anchor = existing.at(-1);
    if (!anchor) return this.planEmptyAccount(account, imported);
    const items: AccountCsvBalancePlanItem[] = [];
    let running = anchor.balance ?? account.balance ?? 0;
    let runningAppuser = storedAppuserBalance(anchor, storedAppuserBalance(account, running));
    for (const tx of imported) {
      running += tx.settlementAmount ?? 0;
      runningAppuser = plus(runningAppuser, chainAppuserAmount(tx));
      tx.balance = running;
      tx.appuserCurrencyBalance = runningAppuser;
      items.push({ appuserBalance: runningAppuser, balance: running, imported: true, transaction: tx });
    }
    return { accountAppuserBalance: runningAppuser, accountBalance: running, items };
  }

  private planOlderOnlyImports(account: Account, existing: Transaction[], imported: Transaction[]): AccountCsvBalancePlan {
    const anchor = existing[0];
    if (!anchor) return this.planEmptyAccount(account, imported);
    const items: AccountCsvBalancePlanItem[] = [];
    let running = (anchor.balance ?? account.balance ?? 0) - (anchor.settlementAmount ?? 0);
    let runningAppuser = minus(storedAppuserBalance(anchor, accountAppuserTail(account)), chainAppuserAmount(anchor));
    const reversedImported = [...imported].sort((a, b) => sortByDateThenKey(b, a));
    for (const tx of reversedImported) {
      tx.balance = running;
      tx.appuserCurrencyBalance = runningAppuser;
      items.unshift({ appuserBalance: runningAppuser, balance: running, imported: true, transaction: tx });
      running -= tx.settlementAmount ?? 0;
      runningAppuser = minus(runningAppuser, chainAppuserAmount(tx));
    }
    return { accountAppuserBalance: accountAppuserTail(account), accountBalance: account.balance ?? 0, items };
  }
}

/**
 * The chain's total order — `(transactionDate, transactionKey)`, matching
 * `balance-chain.service.ts` and the reverse of the order the transactions list renders.
 *
 * Date ties are not broken on `settlementAmount`: same-date rows would then be given balances in
 * amount order but displayed in key order — a third ordering, disagreeing with both the
 * manual-creation path and the read path. Not-yet-persisted imports have no `transactionKey` yet and
 * still sort last within their date, which is where the INSERT will put them.
 */
/** The balance before the oldest row in chain order: its running balance minus its amount. */
function openingBalanceOf(transactions: Transaction[]): number | undefined {
  const oldest = [...transactions].sort(sortByDateThenKey)[0];
  if (oldest?.balance == null) return undefined;
  return subtractMoney(oldest.balance, oldest.settlementAmount ?? 0);
}

function sortByDateThenKey(a: Transaction, b: Transaction) {
  const left = a.transactionDate?.getTime() ?? 0;
  const right = b.transactionDate?.getTime() ?? 0;
  if (left !== right) return left - right;
  const leftKey = (a as { transactionKey?: number }).transactionKey ?? Number.POSITIVE_INFINITY;
  const rightKey = (b as { transactionKey?: number }).transactionKey ?? Number.POSITIVE_INFINITY;
  return leftKey - rightKey;
}

export default new AccountCsvBalanceRecalculationService();
