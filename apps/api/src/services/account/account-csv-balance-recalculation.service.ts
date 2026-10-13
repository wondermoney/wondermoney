import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { subtractMoney, sumMoney } from '@utils/money';

export interface AccountCsvBalancePlan {
  accountAppuserBalance?: number;
  accountBalance: number;
  items: AccountCsvBalancePlanItem[];
}

export interface AccountCsvBalancePlanItem {
  appuserBalance?: number;
  balance: number;
  imported: boolean;
  transaction: Transaction;
}

class AccountCsvBalanceRecalculationService {
  planBankBalances(account: Account, existingTransactions: Transaction[], importedTransactions: Transaction[]): AccountCsvBalancePlan {
    const existing = [...existingTransactions].sort(sortByDateThenKey);
    const imported = [...importedTransactions].sort(sortByDateThenKey);
    const currentBalance = account.balance ?? 0;
    const currentAppuserBalance = account.appuserCurrencyBalance ?? currentBalance;
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
    const currentAppuserBalance = account.appuserCurrencyBalance ?? currentBalance;
    let forward = subtractMoney(currentBalance, sumMoney(imported.map((tx) => tx.settlementAmount)));
    let forwardAppuser = subtractMoney(currentAppuserBalance, sumMoney(imported.map((tx) => tx.appuserSettlementAmount ?? tx.settlementAmount)));
    const items: AccountCsvBalancePlanItem[] = [];
    for (const tx of imported) {
      forward += tx.settlementAmount ?? 0;
      forwardAppuser += tx.appuserSettlementAmount ?? tx.settlementAmount ?? 0;
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
    const preAnchorAppuser = (firstExisting.appuserCurrencyBalance ?? account.appuserCurrencyBalance ?? account.balance ?? 0) - (firstExisting.appuserSettlementAmount ?? firstExisting.settlementAmount ?? 0);
    let running = preAnchor;
    let runningAppuser = preAnchorAppuser;

    const olderImported = imported.filter((tx) => (tx.transactionDate?.getTime() ?? 0) < firstExistingTime).sort((a, b) => sortByDateThenKey(b, a));
    for (const tx of olderImported) {
      tx.balance = running;
      tx.appuserCurrencyBalance = runningAppuser;
      items.unshift({ appuserBalance: runningAppuser, balance: running, imported: true, transaction: tx });
      running -= tx.settlementAmount ?? 0;
      runningAppuser -= tx.appuserSettlementAmount ?? tx.settlementAmount ?? 0;
    }

    const forwardEntries = [...existing.map((tx) => ({ kind: 'existing' as const, tx })), ...imported.map((tx) => ({ kind: 'imported' as const, tx }))]
      .filter((entry) => (entry.tx.transactionDate?.getTime() ?? 0) >= firstExistingTime)
      .sort((a, b) => sortByDateThenKey(a.tx, b.tx));
    running = preAnchor;
    runningAppuser = preAnchorAppuser;
    for (const entry of forwardEntries) {
      running += entry.tx.settlementAmount ?? 0;
      runningAppuser += entry.tx.appuserSettlementAmount ?? entry.tx.settlementAmount ?? 0;
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
    let runningAppuser = anchor.appuserCurrencyBalance ?? account.appuserCurrencyBalance ?? running;
    for (const tx of imported) {
      running += tx.settlementAmount ?? 0;
      runningAppuser += tx.appuserSettlementAmount ?? tx.settlementAmount ?? 0;
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
    let runningAppuser = (anchor.appuserCurrencyBalance ?? account.appuserCurrencyBalance ?? account.balance ?? 0) - (anchor.appuserSettlementAmount ?? anchor.settlementAmount ?? 0);
    const reversedImported = [...imported].sort((a, b) => sortByDateThenKey(b, a));
    for (const tx of reversedImported) {
      tx.balance = running;
      tx.appuserCurrencyBalance = runningAppuser;
      items.unshift({ appuserBalance: runningAppuser, balance: running, imported: true, transaction: tx });
      running -= tx.settlementAmount ?? 0;
      runningAppuser -= tx.appuserSettlementAmount ?? tx.settlementAmount ?? 0;
    }
    return { accountAppuserBalance: account.appuserCurrencyBalance ?? account.balance ?? 0, accountBalance: account.balance ?? 0, items };
  }
}

/**
 * The chain's total order — `(transactionDate, transactionKey)`, matching
 * `balance-chain.service.ts` and the reverse of the order the transactions list renders.
 *
 * RAD-564: this used to break date ties on `settlementAmount` first, so same-date rows were given
 * balances in amount order but displayed in key order — a third ordering, disagreeing with both the
 * manual-creation path and the read path. Not-yet-persisted imports have no `transactionKey` yet and
 * still sort last within their date, which is where the INSERT will put them.
 */
function sortByDateThenKey(a: Transaction, b: Transaction) {
  const left = a.transactionDate?.getTime() ?? 0;
  const right = b.transactionDate?.getTime() ?? 0;
  if (left !== right) return left - right;
  const leftKey = (a as { transactionKey?: number }).transactionKey ?? Number.POSITIVE_INFINITY;
  const rightKey = (b as { transactionKey?: number }).transactionKey ?? Number.POSITIVE_INFINITY;
  return leftKey - rightKey;
}

export default new AccountCsvBalanceRecalculationService();
