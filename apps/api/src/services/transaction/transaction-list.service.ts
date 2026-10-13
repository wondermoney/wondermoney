import { type FilterQuery, QueryOrder } from '@mikro-orm/core';
import { orderBy, pick, random } from 'lodash-es';

import { DI } from '@app/app';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { Transaction } from '@entity/Transaction';
import { buildTransactionWhere, getTransactionTotal, type TransactionFilterInput } from '@service/transaction/transaction-total.service';
import { NotFoundError } from '@utils/errors';

export interface TransactionListRequest {
  /** Opaque keyset cursor from a previous page's `nextCursor`; absent for the first page. */
  cursor?: string;
  /** Filters as parsed from the query string. With `accountKey` set, `accountKeys` is ignored. */
  filters: TransactionFilterInput;
  limit: number;
  /** One account's list (`GET /:accountId/transaction`), or every account the viewer can see. */
  scope: 'all-accounts' | { accountKey: number };
  tenantKey: number;
  viewerAppuserKey: number;
}

export interface TransactionRecurringSeriesDto {
  amountType: 'fixed' | 'variable';
  displayName: string;
  recurringSeriesKey: number;
  status: 'candidate' | 'confirmed' | 'dismissed' | 'ended' | 'paused';
  type: 'bill' | 'subscription';
}

/**
 * One page of the transaction list — the single implementation behind both
 * `GET /v1/account/transaction` and `GET /v1/account/:accountId/transaction`, so the two cannot
 * disagree about what a filter, a cursor or the total means (RAD-579).
 *
 * Rows are ordered `(transactionDate DESC, transactionKey DESC)` — the balance chain's order
 * (RAD-564) and exactly `transaction_tenant_date_key_idx`, so keyset paging costs the same at any
 * depth. Each row carries its loan-repayment split and recurring-series membership.
 *
 * Offline accounts with no transaction on the first page get a synthetic "Initial balance" row
 * so the client can show their balance at all (see `syntheticOpeningBalanceRows`).
 *
 * `total` is counted on the first page only: a paginating client already has it, and re-counting
 * the largest table on every page is waste. Later pages answer `total: null`, and `hasMore`
 * falls back to the cursor.
 */
type TransactionRow = ReturnType<typeof toTransactionRow>;

export async function listTransactions(request: TransactionListRequest) {
  const { cursor, limit, scope, tenantKey, viewerAppuserKey } = request;

  const viewer = await DI.em.findOne(Appuser, { appuserKey: viewerAppuserKey }, { populate: ['currencyKey'] });
  if (!viewer) throw new NotFoundError('User not found');

  const accounts = await loadScopeAccounts(scope);
  if (accounts.length === 0) return { hasMore: false, limit, nextCursor: null, total: 0, transactions: [] };

  const filters: TransactionFilterInput = scope === 'all-accounts' ? request.filters : { ...request.filters, accountKeys: [scope.accountKey] };
  const findOptions = request.filters.includeHidden ? { filters: { [HIDDEN_FILTER]: false } } : {};
  const keysetWhere = decodeTransactionCursor(cursor);
  const where = keysetWhere ? ({ $and: [buildTransactionWhere(filters), keysetWhere] } as FilterQuery<Transaction>) : buildTransactionWhere(filters);

  const transactions = await DI.em.find(Transaction, where, {
    limit,
    orderBy: { transactionDate: QueryOrder.DESC, transactionKey: QueryOrder.DESC },
    populate: [
      'accountKey',
      'accountKey.accountFinancialInstitutionKey',
      'settlementCurrencyKey',
      'appuserCurrencyKey',
      'transactionMerchantKey',
      'transactionTypeKey',
      'transactionStatusKey',
      'appuserTransactionCategories.categoryKey',
    ],
    ...findOptions,
  });

  const loanRepayments = await loadLoanRepayments(transactions);
  const rows = transactions.map((transaction) => {
    const row = toTransactionRow(transaction);
    const loanRepayment = summarizeLoanRepayments(loanRepayments.get(transaction.transactionKey) ?? []);
    return loanRepayment ? { ...row, loanRepayment } : row;
  });

  const isFirstPage = !cursor;
  const syntheticRows = isFirstPage ? syntheticOpeningBalanceRows(accounts, transactions, filters, viewer.currencyKey.code) : [];

  const recurringSeries = await loadRecurringSeries(transactions, tenantKey);
  const page = [...syntheticRows, ...rows].map((row) => ({ ...row, recurringSeries: recurringSeries.get(row.transactionKey) ?? null }));

  const total = isFirstPage ? (await getTransactionTotal(filters)) + syntheticRows.length : null;
  const lastRow = transactions.at(-1);
  // Null when this page is the end of the set, so a client can stop without a second call.
  const nextCursor = lastRow && transactions.length >= limit ? encodeTransactionCursor(lastRow) : null;

  return {
    // `total` counts synthetic rows too, so compare it against everything on the page. From page
    // two there is no total and the cursor is the authority on whether another page exists.
    hasMore: total === null ? nextCursor !== null : total > page.length,
    limit,
    nextCursor,
    total,
    transactions: page,
  };
}

async function loadLoanRepayments(transactions: Transaction[]): Promise<Map<number, LoanRepaymentLink[]>> {
  const links = await DI.em.find(
    LoanRepaymentLink,
    { deletedAt: undefined, loanKey: { deletedAt: undefined }, transactionKey: { $in: transactions } },
    { populate: ['loanKey'] },
  );
  const byTransaction = new Map<number, LoanRepaymentLink[]>();
  for (const link of links) {
    const transactionKey = link.transactionKey.transactionKey;
    const current = byTransaction.get(transactionKey);
    if (current) current.push(link);
    else byTransaction.set(transactionKey, [link]);
  }
  return byTransaction;
}

async function loadScopeAccounts(scope: TransactionListRequest['scope']): Promise<Account[]> {
  if (scope === 'all-accounts') {
    return DI.em.find(Account, { deletedAt: undefined }, { populate: ['currencyKey'] });
  }
  const account = await DI.em.findOne(Account, { accountKey: scope.accountKey, deletedAt: undefined }, { populate: ['currencyKey'] });
  if (!account) throw new NotFoundError('Account not found');
  return [account];
}

function toTransactionRow(transaction: Transaction) {
  return pick(
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...transaction,
      appuserTransactionCategories: transaction.appuserTransactionCategories.map((assignment) =>
        pick(assignment.categoryKey, ['categoryKey', 'name', 'icon', 'bgColor', 'textColor', 'parentCategory', 'isSystemCategory']),
      ),
    },
    [
      'transactionKey',
      'transactionDate',
      'transactionTypeKey.name',
      'accountKey.accountKey',
      'accountKey.accountName',
      'accountKey.accountFinancialInstitutionKey.logoUrl',
      'accountKey.currencyKey.code',
      'description',
      'descriptionDirty',
      'settlementAmount',
      'editedSettlementAmount',
      'settlementCurrencyKey.code',
      'appuserSettlementAmount',
      'appuserCurrencyKey.code',
      'balance',
      'appuserCurrencyBalance',
      'transactionMerchantKey.name',
      'hidden',
      'reviewed',
      'categorizationConfidence',
      'categorizationReason',
      'appuserTransactionCategories',
    ],
  );
}

/** A transaction's loan repayment split, summed across every active link (ordered by loan for a stable name). */
function summarizeLoanRepayments(links: LoanRepaymentLink[]) {
  if (links.length === 0) return null;
  const repayments = orderBy(links, [(repayment) => repayment.loanKey.loanKey]);
  const loanKeys = repayments.map((repayment) => repayment.loanKey.loanKey);
  const loanNames = repayments.map((repayment) => repayment.loanKey.name);
  const totals = repayments.reduce(
    (sum, repayment) => ({
      feeAmount: sum.feeAmount + repayment.feeAmount,
      interestAmount: sum.interestAmount + repayment.interestAmount,
      principalAmount: sum.principalAmount + repayment.principalAmount,
    }),
    { feeAmount: 0, interestAmount: 0, principalAmount: 0 },
  );
  return {
    feeAmount: totals.feeAmount,
    interestAmount: totals.interestAmount,
    loanKey: loanKeys[0],
    loanKeys,
    loanName: loanNames.length === 1 ? loanNames[0] : loanNames.join(' | '),
    principalAmount: totals.principalAmount,
    spendingAmount: totals.interestAmount + totals.feeAmount,
  };
}

/**
 * "Initial balance" rows for offline (non-bank-linked) accounts with no transaction on this page.
 *
 * They are not transactions, but the client renders and counts them, so the filters have to treat
 * them the way the browser-side predicates used to (RAD-579):
 *
 *   type      — no `transactionTypeKey`, so any type filter excludes them.
 *   category  — no categories, so a named-category filter excludes them but `__uncategorized__`
 *               *matches* them. That asymmetry is deliberate.
 *   reviewed  — stamped `reviewed: true`, so the needs-review filter excludes them.
 *   account   — they carry an `accountKey`, so the account filter narrows rather than excludes.
 *
 * `confidence` is not in this list: it is a server-side filter that never saw these rows.
 *
 * First page only — they have no position in the keyset order, and re-emitting them on every page
 * (each time with a fresh random negative key) left clients unable to de-duplicate them.
 */
async function loadRecurringSeries(transactions: Transaction[], tenantKey: number): Promise<Map<number | undefined, TransactionRecurringSeriesDto>> {
  const bySeries = new Map<number | undefined, TransactionRecurringSeriesDto>();
  if (transactions.length === 0) return bySeries;

  const occurrences = await DI.em.find(
    RecurringOccurrence,
    {
      deletedAt: undefined,
      recurringSeriesKey: { deletedAt: undefined, tenantKey: { tenantKey } },
      transactionKey: { transactionKey: { $in: transactions.map((transaction) => transaction.transactionKey) } },
    } as FilterQuery<RecurringOccurrence>,
    { populate: ['recurringSeriesKey'] },
  );
  for (const occurrence of occurrences) {
    if (!occurrence.transactionKey) continue;
    const series = occurrence.recurringSeriesKey;
    bySeries.set(occurrence.transactionKey.transactionKey, {
      amountType: series.amountType,
      displayName: series.displayName,
      recurringSeriesKey: series.recurringSeriesKey,
      status: series.status,
      type: series.type,
    });
  }
  return bySeries;
}

function syntheticOpeningBalanceRows(accounts: Account[], transactions: Transaction[], filters: TransactionFilterInput, viewerCurrencyCode: string): TransactionRow[] {
  const { accountKeys, categoryKeys, transactionTypes, unreviewedOnly } = filters;
  const namedCategoriesOnly = categoryKeys !== undefined && categoryKeys.keys.length > 0 && !categoryKeys.includeUncategorized;
  if (unreviewedOnly === true || (transactionTypes !== undefined && transactionTypes.length > 0) || namedCategoriesOnly) return [];

  const accountsOnPage = new Set(transactions.map((transaction) => transaction.accountKey?.accountKey));
  return accounts
    .filter(
      (account) =>
        !account.nordigenRequisitionKey &&
        !accountsOnPage.has(account.accountKey) &&
        (!accountKeys || accountKeys.length === 0 || accountKeys.includes(account.accountKey)),
    )
    .map((account) => ({
      accountKey: { accountKey: account.accountKey, accountName: account.accountName, currencyKey: { code: account.currencyKey.code } } as Account,
      appuserCurrencyBalance: account.appuserCurrencyBalance,
      appuserCurrencyKey: { code: viewerCurrencyCode } as Currency,
      appuserSettlementAmount: account.appuserCurrencyBalance,
      appuserTransactionCategories: [],
      balance: account.balance,
      description: 'Initial balance',
      descriptionDirty: 'This is a fake transaction to reflect the initial balance of the account',
      hidden: false,
      reviewed: true,
      settlementAmount: account.balance,
      settlementCurrencyKey: { code: account.currencyKey.code } as Currency,
      transactionDate: account.createdAt,
      transactionKey: random(Number.MIN_SAFE_INTEGER, -1),
    }));
}

/** `<epochMs>_<transactionKey>` of the last row on a page. Opaque to clients. */
function encodeTransactionCursor(transaction: Transaction): null | string {
  const date = transaction.transactionDate;
  if (!date) return null;
  return `${date.getTime()}_${transaction.transactionKey}`;
}

/**
 * Turn a cursor into the keyset predicate for `(transactionDate DESC, transactionKey DESC)`:
 * strictly older, or same instant with a strictly smaller key. An absent or malformed cursor
 * yields no predicate, i.e. the first page.
 */
function decodeTransactionCursor(cursor: string | undefined): FilterQuery<Transaction> | null {
  if (!cursor) return null;
  const [rawTime, rawKey] = cursor.split('_');
  const time = Number(rawTime);
  const key = Number(rawKey);
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(key)) return null;
  const at = new Date(time);
  return {
    $or: [{ transactionDate: { $lt: at } }, { transactionDate: at, transactionKey: { $lt: key } }],
  } as FilterQuery<Transaction>;
}
