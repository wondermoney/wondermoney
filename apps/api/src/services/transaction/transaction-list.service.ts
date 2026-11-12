import { type FilterQuery, QueryOrder } from '@mikro-orm/core';
import { orderBy, pick } from 'lodash-es';

import { DI } from '@app/app';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { Transaction } from '@entity/Transaction';
import { TransactionAttachment } from '@entity/TransactionAttachment';
import { type RateScope, rateScope } from '@service/currency/exchange-rate';
import { describeFx, type FxDisplay, UNKNOWN_FX } from '@service/currency/fx-display';
import { completenessFromCounts } from '@service/reports/report-currency';
import { compareTags, type TagDto, toTagDto } from '@service/tag/tag.service';
import { type CategorySpendingFlags, loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { toMerchantDto } from '@service/transaction/merchant-logo';
import { isBankSyncedTransaction } from '@service/transaction/transaction-deletion.service';
import { SPLIT_LINE_POPULATE, type SplitLineDto, toSplitLineDtos } from '@service/transaction/transaction-split.service';
import { buildTransactionWhere, getTransactionTotal, hasReportScope, type TransactionFilterInput, type TransactionViewer } from '@service/transaction/transaction-total.service';
import { TRANSFER_DESTINATION_POPULATE, type TransferDestinationDto, transferDestinationOf } from '@service/transaction/transaction-transfer.service';
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

/** The installment a posted row pays, shown as "n/N" in the lists. */
export interface TransactionInstallmentDto {
  installmentCount: number;
  installmentNumber: number;
  installmentPlanKey: number;
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
 * disagree about what a filter, a cursor or the total means.
 *
 * Rows are ordered `(transactionDate DESC, transactionKey DESC)` — the balance chain's order
 * and exactly `transaction_tenant_date_key_idx`, so keyset paging costs the same at any
 * depth. Each row carries its loan-repayment split and recurring-series membership.
 *
 * Offline accounts with no transaction at all get a synthetic "Initial balance" row so the client
 * can show their balance at all (see `syntheticOpeningBalanceRows`). It sits at the account's
 * creation date in the same order, on whichever page that date falls.
 *
 * `total` is counted on the first page only: a paginating client already has it, and re-counting
 * the largest table on every page is waste. Later pages answer `total: null`, and `hasMore`
 * falls back to the cursor. `totalAmount` and its `moneyIn` and `moneyOut` parts (in the viewer's
 * currency, with their `completeness`) are the first page's too, summed by the same query as the
 * count; they add real transactions only.
 */
type TransactionRow = ReturnType<typeof toTransactionRow>;

export async function listTransactions(request: TransactionListRequest) {
  const { cursor, limit, scope, tenantKey, viewerAppuserKey } = request;

  const viewer = await DI.em.findOne(Appuser, { appuserKey: viewerAppuserKey }, { populate: ['currencyKey'] });
  if (!viewer) throw new NotFoundError('User not found');

  const transactionViewer: TransactionViewer = { currency: { code: viewer.currencyKey.code, currencyKey: viewer.currencyKey.currencyKey }, tenantKey, viewerAppuserKey };
  const accounts = await loadScopeAccounts(scope, transactionViewer);
  if (accounts.length === 0) {
    const totals = cursor ? { completeness: null, moneyIn: null, moneyOut: null, totalAmount: null } : { completeness: completenessFromCounts(transactionViewer.currency.code, []), moneyIn: 0, moneyOut: 0, totalAmount: 0 };
    return { hasMore: false, limit, nextCursor: null, total: 0, ...totals, transactions: [] };
  }

  const filters: TransactionFilterInput = scope === 'all-accounts' ? request.filters : { ...request.filters, accountKeys: [scope.accountKey] };
  const findOptions = request.filters.includeHidden ? { filters: { [HIDDEN_FILTER]: false } } : {};
  const keysetWhere = decodeTransactionCursor(cursor);
  const where = keysetWhere ? ({ $and: [buildTransactionWhere(filters, transactionViewer), keysetWhere] } as FilterQuery<Transaction>) : buildTransactionWhere(filters, transactionViewer);

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
      'appuserTransactionCategories.categoryKey.parentCategory',
      'transactionTags.tagKey',
      ...SPLIT_LINE_POPULATE,
      ...TRANSFER_DESTINATION_POPULATE,
    ],
    ...findOptions,
  });

  const loanRepayments = await loadLoanRepayments(transactions);
  const attachmentCounts = await loadAttachmentCounts(transactions);
  const spendingFlags = await loadCategorySpendingFlags(DI.em, tenantKey);
  const fx = await describeTransactionsFx(transactions, rateScope(tenantKey));
  const rows = transactions.map((transaction, index) => {
    const row = {
      ...toTransactionRow(transaction, viewerAppuserKey, spendingFlags),
      ...(fx[index] ?? UNKNOWN_FX),
      // The ledger shows a paperclip only when there is something behind it.
      attachmentCount: attachmentCounts.get(transaction.transactionKey) ?? 0,
    };
    const loanRepayment = summarizeLoanRepayments(loanRepayments.get(transaction.transactionKey) ?? []);
    return loanRepayment ? { ...row, loanRepayment } : row;
  });

  const isFirstPage = !cursor;
  const lastRow = transactions.at(-1);
  // Null when this page is the end of the set, so a client can stop without a second call.
  const nextCursor = lastRow && transactions.length >= limit ? encodeTransactionCursor(lastRow) : null;

  const syntheticRows = await syntheticOpeningBalanceRows(accounts, filters, viewer.currencyKey.code, rateScope(tenantKey));
  const pageSyntheticRows = syntheticRows.filter((row) => onThisPage(row.transactionDate, cursorTime(cursor), nextCursor ? lastRow?.transactionDate : undefined));

  const recurringSeries = await loadRecurringSeries(transactions, tenantKey);
  const installments = await loadInstallments(transactions);
  // Newest first, an opening row after any real row of the same instant: it came before them.
  const page = orderBy([...rows, ...pageSyntheticRows], [(row) => row.transactionDate?.getTime() ?? 0, (row) => ((row.transactionKey ?? 0) < 0 ? 0 : 1)], ['desc', 'desc']).map(
    (row) => ({ ...row, installment: installments.get(row.transactionKey) ?? null, recurringSeries: recurringSeries.get(row.transactionKey) ?? null }),
  );

  const listTotal = isFirstPage ? await getTransactionTotal(filters, transactionViewer) : null;
  const total = listTotal ? listTotal.count + syntheticRows.length : null;

  return {
    completeness: listTotal?.completeness ?? null,
    // `total` counts synthetic rows too, so compare it against everything on the page. From page
    // two there is no total and the cursor is the authority on whether another page exists.
    hasMore: total === null ? nextCursor !== null : total > page.length,
    limit,
    moneyIn: listTotal?.moneyIn ?? null,
    moneyOut: listTotal?.moneyOut ?? null,
    nextCursor,
    total,
    totalAmount: listTotal?.amount ?? null,
    transactions: page,
  };
}

/** How each row's amount in the user's currency was converted (`fx-display.ts`), at the household's rates. */
async function describeTransactionsFx(transactions: Transaction[], scope: RateScope): Promise<FxDisplay[]> {
  return describeFx(
    DI.em,
    transactions.map((transaction) => ({
      converted: transaction.appuserSettlementAmount,
      date: transaction.transactionDate ?? transaction.createdAt,
      from: transaction.settlementCurrencyKey,
      status: transaction.fxStatus,
      to: transaction.appuserCurrencyKey,
    })),
    scope,
  );
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

/**
 * How many live attachments each row has, in one query for the page. The tenant filter scopes the
 * count; the explicit transaction list keeps it to this page.
 */
async function loadAttachmentCounts(transactions: Transaction[]): Promise<Map<number, number>> {
  if (transactions.length === 0) return new Map();
  const rows = await DI.em.find(
    TransactionAttachment,
    { deletedAt: undefined, transactionKey: { $in: transactions } },
    { fields: ['transactionKey'] },
  );
  const counts = new Map<number, number>();
  for (const row of rows) {
    const key = row.transactionKey.transactionKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The accounts the list covers: the household's, a private one only for its owner. Explicit, so it holds with no tenant filter set too. */
async function loadScopeAccounts(scope: TransactionListRequest['scope'], viewer: TransactionViewer): Promise<Account[]> {
  const visible: FilterQuery<Account> = { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: viewer.viewerAppuserKey } }], deletedAt: undefined, tenantKey: { tenantKey: viewer.tenantKey } };
  if (scope === 'all-accounts') {
    return DI.em.find(Account, visible, { populate: ['currencyKey', 'accountFinancialInstitutionKey', 'accountOwnerAppuserKey.currencyKey'] });
  }
  const account = await DI.em.findOne(Account, { $and: [visible, { accountKey: scope.accountKey }] }, { populate: ['currencyKey', 'accountFinancialInstitutionKey', 'accountOwnerAppuserKey.currencyKey'] });
  if (!account) throw new NotFoundError('Account not found');
  return [account];
}

function pickTransactionRow(transaction: Transaction, spendingFlags: CategorySpendingFlags) {
  return pick(
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...transaction,
      // `countsAsSpending` is the household's value, the parent's included (`category-spending.ts`).
      appuserTransactionCategories: transaction.appuserTransactionCategories.map((assignment) => ({
        ...pick(assignment.categoryKey, ['categoryKey', 'name', 'icon', 'bgColor', 'textColor', 'isSystemCategory']),
        countsAsSpending: spendingFlags.countsAsSpending(assignment.categoryKey),
        parentCategory: assignment.categoryKey.parentCategory?.categoryKey,
      })),
      // The merchant with its website and the logo to show (`merchant-logo.ts`); absent without one.
      transactionMerchantKey: transaction.transactionMerchantKey ? toMerchantDto(transaction.transactionMerchantKey) : undefined,
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
      'transactionMerchantKey',
      'hidden',
      'reviewed',
      'categorizationConfidence',
      'categorizationReason',
      'appuserTransactionCategories',
    ],
  );
}

/**
 * A row carries its tags and, when it is split, its lines (empty otherwise). A split row's
 * `appuserTransactionCategories` is the largest line's category; clients show the lines instead.
 * An outgoing transfer carries where it went, when the user said so.
 */
function toTransactionRow(transaction: Transaction, viewerAppuserKey: number, spendingFlags: CategorySpendingFlags): Omit<ReturnType<typeof pickTransactionRow>, 'splits'> & { bankSynced: boolean; splits: SplitLineDto[]; tags: TagDto[]; transferDestination: null | TransferDestinationDto } {
  return {
    ...pickTransactionRow(transaction, spendingFlags),
    // The bank sent it, so it cannot be deleted (`transaction-deletion.service.ts`): a client says so before asking.
    bankSynced: isBankSyncedTransaction(transaction),
    splits: toSplitLineDtos(transaction),
    tags: rowTags(transaction),
    transferDestination: transferDestinationOf(transaction, viewerAppuserKey),
  };
}

/** The row's tags, by name. The links come through the tenant filter, so only a visible row has any. */
function rowTags(transaction: Transaction): TagDto[] {
  return transaction.transactionTags
    .getItems()
    .map((link) => link.tagKey)
    .filter((tag) => !tag.deletedAt)
    .map(toTagDto)
    .sort(compareTags);
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
 * "Initial balance" rows for offline (non-bank-linked) accounts with no transaction at all. Their
 * balance has never moved, so the row carries it, dated when the account was created.
 *
 * They are not transactions, but the client renders and counts them, so the filters have to treat
 * them the way the client would:
 *
 *   type      — no `transactionTypeKey`, so any type filter excludes them.
 *   category  — no categories, so a named-category filter excludes them but `__uncategorized__`
 *               *matches* them. That asymmetry is deliberate.
 *   reviewed  — stamped `reviewed: true`, so the needs-review filter excludes them.
 *   tag       — no tags, so any tag filter excludes them.
 *   scope     — not a transaction, so a report's scope (statuses, transfers, spending, direction,
 *               merchant, member currency) excludes them.
 *   account   — they carry an `accountKey`, so the account filter narrows rather than excludes.
 *   date      — dated at the account's creation, so a date range excludes them like a real row.
 *
 * `confidence` is not in this list: it is a server-side filter that never saw these rows.
 *
 * Each page emits only the rows whose date falls within it (`onThisPage`), and the key is the
 * account's, negated, so a client that sees one twice can de-duplicate it.
 */
/**
 * The installment each posted row pays ("3/12"), for the list's badge. The plan is read through the
 * tenant filter, so only a plan the viewer can see names one; a row of a deleted plan has none.
 */
async function loadInstallments(transactions: Transaction[]): Promise<Map<number | undefined, TransactionInstallmentDto>> {
  const byTransaction = new Map<number | undefined, TransactionInstallmentDto>();
  const linked = transactions.filter((transaction) => transaction.installmentPlanKey && transaction.installmentNumber != null);
  if (linked.length === 0) return byTransaction;
  const plans = await DI.em.find(InstallmentPlan, { deletedAt: null, installmentPlanKey: { $in: [...new Set(linked.map((transaction) => transaction.installmentPlanKey?.installmentPlanKey ?? 0))] } });
  const countByPlan = new Map(plans.map((plan) => [plan.installmentPlanKey, plan.installmentCount]));
  for (const transaction of linked) {
    const planKey = transaction.installmentPlanKey?.installmentPlanKey;
    const count = planKey === undefined ? undefined : countByPlan.get(planKey);
    if (planKey === undefined || count === undefined || transaction.installmentNumber == null) continue;
    byTransaction.set(transaction.transactionKey, { installmentCount: count, installmentNumber: transaction.installmentNumber, installmentPlanKey: planKey });
  }
  return byTransaction;
}

async function loadRecurringSeries(transactions: Transaction[], tenantKey: number): Promise<Map<number | undefined, TransactionRecurringSeriesDto>> {
  const bySeries = new Map<number | undefined, TransactionRecurringSeriesDto>();
  if (transactions.length === 0) return bySeries;

  const occurrences = await DI.em.find(
    RecurringOccurrence,
    {
      deletedAt: undefined,
      recurringSeriesKey: { deletedAt: undefined, tenantKey: { tenantKey } },
      transactionKey: { transactionKey: { $in: transactions.map((transaction) => transaction.transactionKey) } },
    },
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

async function syntheticOpeningBalanceRows(accounts: Account[], filters: TransactionFilterInput, viewerCurrencyCode: string, scope: RateScope): Promise<(FxDisplay & TransactionRow)[]> {
  const { accountKeys, categoryKeys, fromDate, tagKeys, toDate, transactionTypes, unreviewedOnly } = filters;
  const namedCategoriesOnly = categoryKeys !== undefined && categoryKeys.keys.length > 0 && !categoryKeys.includeUncategorized;
  const tagged = tagKeys !== undefined && tagKeys.length > 0;
  // A report's rows are transactions only: an opening balance is no income, spending or transfer.
  if (unreviewedOnly === true || (transactionTypes !== undefined && transactionTypes.length > 0) || namedCategoriesOnly || tagged || hasReportScope(filters)) return [];

  const candidates = accounts.filter(
    (account) =>
      !account.nordigenRequisitionKey &&
      (!accountKeys || accountKeys.length === 0 || accountKeys.includes(account.accountKey)) &&
      (!fromDate || account.createdAt >= fromDate) &&
      (!toDate || account.createdAt <= toDate),
  );
  // Hidden rows count: a balance that moved through a hidden row has still moved.
  const transactionCounts = await Promise.all(
    candidates.map((account) =>
      DI.em.count(Transaction, { accountKey: { accountKey: account.accountKey }, deletedAt: undefined }, { filters: { [HIDDEN_FILTER]: false } }),
    ),
  );
  const opened = candidates.filter((_, index) => transactionCounts[index] === 0);
  // The row carries the account's balance, converted the way the account's was.
  const fx = await describeFx(
    DI.em,
    opened.map((account) => ({ converted: account.appuserCurrencyBalance, date: new Date(), from: account.currencyKey, status: account.fxStatus, to: account.accountOwnerAppuserKey?.currencyKey })),
    scope,
  );
  return opened
    .map((account, index) => ({
      ...(fx[index] ?? UNKNOWN_FX),
      // The institution's logo is the opening row's mark, as on the account's real rows.
      accountKey: {
        accountFinancialInstitutionKey: account.accountFinancialInstitutionKey ? { logoUrl: account.accountFinancialInstitutionKey.logoUrl ?? null } : null,
        accountKey: account.accountKey,
        accountName: account.accountName,
        currencyKey: { code: account.currencyKey.code },
      } as unknown as Account,
      appuserCurrencyBalance: account.appuserCurrencyBalance,
      appuserCurrencyKey: { code: viewerCurrencyCode } as Currency,
      appuserSettlementAmount: account.appuserCurrencyBalance,
      appuserTransactionCategories: [],
      attachmentCount: 0,
      balance: account.balance,
      bankSynced: false,
      description: 'Initial balance',
      descriptionDirty: 'This is a fake transaction to reflect the initial balance of the account',
      hidden: false,
      reviewed: true,
      settlementAmount: account.balance,
      settlementCurrencyKey: { code: account.currencyKey.code } as Currency,
      splits: [],
      tags: [],
      transactionDate: account.createdAt,
      transactionKey: -account.accountKey,
      transferDestination: null,
    }));
}

/** The page spans `[its last row's date, the cursor's date)`; the first page has no upper end and the last no lower one. */
function cursorTime(cursor: string | undefined): Date | undefined {
  const time = Number(cursor?.split('_')[0]);
  return cursor && Number.isSafeInteger(time) ? new Date(time) : undefined;
}

function onThisPage(date: Date | undefined, before: Date | undefined, from: Date | undefined): boolean {
  if (!date) return false;
  return (!before || date < before) && (!from || date >= from);
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
  };
}
