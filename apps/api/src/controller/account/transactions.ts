import { LockMode, QueryOrder } from '@mikro-orm/core';
import { startOfMonth } from 'date-fns';
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'kysely';
import { orderBy, pick } from 'lodash-es';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { sqlQuery } from '@app/database/sql';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Category } from '@entity/Category';
import { Rule } from '@entity/Rule';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionType } from '@entity/TransactionType';
import { authedContext, authedUser } from '@middleware/authed-context';
import { convertWithStatus, rateScope } from '@service/currency/exchange-rate';
import { loadLoanRepaymentLinks, loadViewerCurrencyAmounts, REPORT_CURRENCY_POPULATE } from '@service/reports/report-currency';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { CATEGORY_LINE_POPULATE, spendingLinesOf } from '@service/transaction/category-lines';
import { loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { findAssignableCategory } from '@service/transaction/household-category';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';
import { findManualDuplicate } from '@service/transaction/transaction-dedup.service';
import { listTransactions } from '@service/transaction/transaction-list.service';
import { getTransactionReviewSummary as getReviewSummary } from '@service/transaction/transaction-review-summary.service';
import { dashboardScope, transactionScopeWhere } from '@service/transaction/transaction-scope';
import { reconcileSplitsWithAmount } from '@service/transaction/transaction-split.service';
import { retypeTransaction, TRANSFER_DESTINATION_POPULATE, transferDestinationOf } from '@service/transaction/transaction-transfer.service';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';
import { BadRequestError, InternalServerError, NotFoundError, UnauthorizedError } from '@utils/errors';
import { addMoney } from '@utils/money';
import {
  createTransactionRequestSchema,
  getAccountTransactionsRequestSchema,
  getCategorySpendingRequestSchema,
  getTransactionHistoryRequestSchema,
  getTransactionMerchantsRequestSchema,
  getTransactionsRequestSchema,
  updateTransactionRequestSchema,
  updateTransactionsRequestSchema,
} from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

type CategorySpending = Record<
  string,
  {
    amount: number;
    bgColor: string;
    categoryKey: number;
    childCategories: Record<
      string,
      {
        amount: number;
        bgColor: string;
        categoryKey: number;
        currency?: string;
        icon?: string;
        isSystemCategory: boolean;
        numTransactions: number;
        textColor: string;
      }
    >;
    currency?: string;
    icon?: string;
    isSystemCategory: boolean;
    numTransactions: number;
    textColor: string;
  }
>;


export async function createTransaction(req: Request, res: Response, next: NextFunction) {
  const {
    body: {
      categoryId,
      description,
      exchangeRate,
      notes,
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      tagIds,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    },
    params: { accountId },
  } = await zParse(createTransactionRequestSchema, req);
  const authenticatedUser = authedUser(req);

  try {
    // Warn-and-allow duplicate hint (flag-gated, additive). Never blocks the create.
    const duplicateMatch = await findManualDuplicate(DI.em, {
      accountKey: accountId,
      amount: originalAmount ?? settlementAmount,
      transactionDate,
    });
    const created = await transactionCreationService.createTransaction({
      accountId,
      appuserKey: authenticatedUser.appuserKey,
      categoryId,
      description,
      enteredByHand: true,
      exchangeRate,
      notes,
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      tagIds,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    });
    if (duplicateMatch) {
      // Record that the fingerprint flagged a possible duplicate but we still created the
      // row. Distinct from the sync path's DEDUP_SKIPPED (which skips the create) so audits can tell
      // legitimate manual collisions apart from data-losing skips. Best-effort; never blocks.
      await TransactionAuditService.log(DI.em, {
        accountKey: accountId,
        actorAppuserKey: authenticatedUser.appuserKey,
        actorType: TransactionAuditActorType.USER,
        appuserKey: authenticatedUser.appuserKey,
        changes: {
          flaggedAgainstTransactionKey: { from: null, to: duplicateMatch.existing.transactionKey },
          matchedOn: { from: null, to: duplicateMatch.matchedOn },
        },
        eventType: TransactionAuditEventType.DEDUP_FLAGGED,
        source: 'manual-transaction',
        tenantKey: created.tenantKey!.tenantKey,
        transactionKey: created.transactionKey,
      });
    }
    return res.status(201).json({ possibleDuplicate: duplicateMatch !== null });
  } catch (err) {
    next(err);
    return;
  }
}

export async function getAccountTransactions(req: Request, res: Response) {
  // The path `accountId` is authoritative (route is `GET /:accountId/transaction`); the
  // `?accountId=` query is legacy and tolerated for rolling compatibility.
  const {
    query: { categoryKeys, confidence, cursor, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, limit, memberCurrency, merchantKeys, statuses, tagKeys, timezone, toDate, transactionTypes, unreviewedOnly },
  } = await zParse(getAccountTransactionsRequestSchema, req);
  const accountParam = req.params['accountId'];
  const accountKey = Number.parseInt(typeof accountParam === 'string' ? accountParam : '', 10);
  if (!Number.isInteger(accountKey) || accountKey <= 0) throw new BadRequestError('Account id is required');
  const { tenant, user } = authedContext(req);
  const page = await listTransactions({
    cursor,
    filters: { categoryKeys, confidence, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, memberCurrencyCode: memberCurrency, merchantKeys, statuses, tagKeys, timeZone: timezone, toDate, transactionTypes, unreviewedOnly },
    limit,
    scope: { accountKey },
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  });
  return res.json(page);
}

export async function getCategorySpending(req: Request, res: Response, _next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    query: { fromDate, limit, timezone, toDate },
  } = await zParse(getCategorySpendingRequestSchema, req);

  // The dashboard's rows (`dashboardScope`), money out only: pending counts, EXPIRED rows
  // never moved money, a transfer between own accounts is not spending, and a row wholly in
  // categories that are not spending is left out. A row with no converted amount is read by the
  // sign of its own amount, so it is counted as left out below.
  const scope = dashboardScope({ dateRange: { from: fromDate ?? startOfMonth(new Date()), timeZone: timezone, to: toDate }, tenantKey: tenant.tenantKey, viewerAppuserKey: user.appuserKey });
  const expenseTransactions = await DI.em.find(Transaction, transactionScopeWhere({ ...scope, direction: 'out' }), {
    populate: [...CATEGORY_LINE_POPULATE, ...REPORT_CURRENCY_POPULATE],
  });
  const spendingFlags = await loadCategorySpendingFlags(DI.em, tenant.tenantKey);
  const repayments = await loadLoanRepaymentLinks(DI.em, tenant, expenseTransactions);
  // Members keep their own currencies: every amount, and a loan repayment's interest and fees (in
  // the loan's currency), is converted into the viewer's at the rate of the transaction's date. A
  // row with no rate is left out and counted in `completeness`, never added at face value.
  const amounts = await loadViewerCurrencyAmounts(DI.em, user, rateScope(tenant), expenseTransactions, repayments);
  const viewerCurrency = amounts.currencyCode;
  // Keyed by top-level category name. Every expense adds to its top-level entry, whether it sits
  // on that category directly or on one of its children.
  const categorySpending: CategorySpending = {};
  type CategoryDisplay = Pick<Category, 'bgColor' | 'categoryKey' | 'icon' | 'isSystemCategory' | 'textColor'>;
  const display = (category: CategoryDisplay, currency: string | undefined) => ({
    bgColor: category.bgColor,
    categoryKey: category.categoryKey,
    currency,
    icon: category.icon,
    isSystemCategory: category.isSystemCategory,
    textColor: category.textColor,
  });
  const uncategorized: CategoryDisplay = { bgColor: '#000000', categoryKey: -1, icon: undefined, isSystemCategory: true, textColor: '#FFFFFF' };
  // Each line of a split transaction counts in its own category, like a separate transaction; a line
  // in a category that is not spending (investments, savings) is left out.
  const lines = expenseTransactions.flatMap((transaction) => {
    // A row none of whose lines counts as spending is neither added nor counted as left out.
    if (spendingLinesOf(transaction, null, spendingFlags).length === 0) return [];
    const spending = amounts.spendingAmountOf(transaction, repayments.get(transaction.transactionKey) ?? []);
    if (spending === null) return [];
    return spendingLinesOf(transaction, spending, spendingFlags).map((line) => ({ amount: Math.abs(line.amount ?? 0), category: line.category ?? undefined, currency: viewerCurrency }));
  });
  for (const { amount, category: trxCategory, currency } of lines) {
    const parentCategory = trxCategory?.parentCategory ?? undefined;
    const topLevel = parentCategory ?? trxCategory;
    const topLevelName = topLevel?.name ?? 'Uncategorized';

    const entry = (categorySpending[topLevelName] ??= { ...display(topLevel ?? uncategorized, currency), amount: 0, childCategories: {}, numTransactions: 0 });
    entry.amount = addMoney(entry.amount, amount);
    entry.numTransactions += 1;

    if (parentCategory && trxCategory) {
      const child = (entry.childCategories[trxCategory.name] ??= { ...display(trxCategory, currency), amount: 0, numTransactions: 0 });
      child.amount = addMoney(child.amount, amount);
      child.numTransactions += 1;
    }
  }

  const transformedData = Object.entries(categorySpending).map(([name, { childCategories, ...rest }]) => ({
    childCategories: Object.entries(childCategories).map(([name, rest]) => ({
      name,
      ...rest,
    })),
    name,
    ...rest,
  }));

  const limitedData = orderBy(transformedData, 'amount', 'desc').slice(0, limit);

  return res.json({ categorySpending: limitedData, completeness: amounts.completeness() });
}

export async function getTransactionHistory(req: Request, res: Response, next: NextFunction) {
  const {
    params: { transactionId },
  } = await zParse(getTransactionHistoryRequestSchema, req);
  const user = req.user;
  const tenant = req.tenant;
  if (!user || !tenant) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }
  // Ownership + tenant scope check before exposing any history.
  // An explicitly-requested transaction (already id/tenant-scoped) must be loadable even
  // when hidden — a revealed transaction's audit history must not 404. Disable only the hidden filter.
  const transaction = await DI.em.findOne(
    Transaction,
    {
      deletedAt: undefined,
      tenantKey: tenant,
      transactionKey: transactionId,
    },
    { filters: { [HIDDEN_FILTER]: false } },
  );
  if (!transaction) {
    next(new NotFoundError('Transaction not found'));
    return;
  }
  const history = await DI.em.find(
    TransactionAuditLog,
    { deletedAt: undefined, tenantKey: tenant, transactionKey: transaction },
    { orderBy: { createdAt: QueryOrder.DESC } },
  );
  // An entry a rule wrote names the rule, so the history can say which one. Both members see every
  // household rule; a rule deleted since keeps its name here.
  const ruleKeysOf = (entry: TransactionAuditLog): number[] => {
    const ruleKeys = (entry.changes as null | Record<string, undefined | { to?: unknown }>)?.['ruleKeys']?.to;
    return Array.isArray(ruleKeys) ? ruleKeys.filter((key): key is number => Number.isInteger(key)) : [];
  };
  const ruleKeys = [...new Set(history.flatMap(ruleKeysOf))];
  const rules = ruleKeys.length > 0 ? await DI.em.find(Rule, { ruleKey: { $in: ruleKeys }, tenantKey: tenant }, { fields: ['name', 'ruleKey'] }) : [];
  const ruleNames = new Map(rules.map((rule) => [rule.ruleKey, rule.name]));
  const transformedData = history.map((entry) => {
    const picked = pick(entry, ['transactionAuditLogKey', 'eventType', 'actorType', 'actorAppuserKey.appuserKey', 'source', 'changes', 'createdAt']);
    const named = ruleKeysOf(entry).flatMap((ruleKey) => {
      const name = ruleNames.get(ruleKey);
      return name === undefined ? [] : [{ name, ruleKey }];
    });
    return named.length > 0 ? { ...picked, rules: named } : picked;
  });
  return res.json({ history: transformedData });
}

export async function getTransactionMerchants(req: Request, res: Response) {
  const {
    query: { limit, search },
  } = await zParse(getTransactionMerchantsRequestSchema, req);
  const { appuserKey, tenantKey } = authedContext(req);
  const normalizedSearch = search ? normalizeMerchantName(search) : undefined;
  const privateMerchantKeys = await findMerchantsSeenOnlyOnOthersPrivateAccounts(tenantKey, appuserKey);

  const transactionMerchants = await DI.em.find(
    TransactionMerchant,
    {
      deletedAt: undefined,
      ...(normalizedSearch ? { normalizedName: { $like: `%${normalizedSearch}%` } } : {}),
      ...(privateMerchantKeys.length > 0 ? { transactionMerchantKey: { $nin: privateMerchantKeys } } : {}),
      tenantKey: req.tenant,
    },
    {
      limit,
      orderBy: { name: QueryOrder.ASC },
    },
  );
  const transformedData = transactionMerchants.map((t) => pick(t, ['transactionMerchantKey', 'name']));
  return res.json({ transactionMerchants: transformedData });
}

export async function getTransactions(req: Request, res: Response) {
  const {
    query: { accountKeys, categoryKeys, confidence, cursor, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, limit, memberCurrency, merchantKeys, statuses, tagKeys, timezone, toDate, transactionTypes, unreviewedOnly },
  } = await zParse(getTransactionsRequestSchema, req);
  const { tenant, user } = authedContext(req);
  const page = await listTransactions({
    cursor,
    filters: { accountKeys, categoryKeys, confidence, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, memberCurrencyCode: memberCurrency, merchantKeys, statuses, tagKeys, timeZone: timezone, toDate, transactionTypes, unreviewedOnly },
    limit,
    scope: 'all-accounts',
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  });
  return res.json(page);
}

/** The home's review status: the review inbox's count and the amount at stake. */
export async function getTransactionReviewSummary(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  return res.json(await getReviewSummary({ tenantKey: tenant.tenantKey, viewerAppuserKey: user.appuserKey }));
}

export async function getTransactionTypes(_req: Request, res: Response) {
  const transactionTypes = await DI.em.find(
    TransactionType,
    {},
    {
      orderBy: { name: QueryOrder.ASC },
    },
  );
  // pick only the key and name
  const transformedData = transactionTypes.map((t) => pick(t, ['transactionTypeKey', 'name']));
  return res.json({ transactionTypes: transformedData });
}

export async function updateTransaction(req: Request, res: Response, next: NextFunction) {
  const {
    body: { categoryKey, statementDateOverride, transactionType, transferDestination, updatedAmount },
    params: { transactionId },
  } = await zParse(updateTransactionRequestSchema, req);
  // Authorize before any database access — a missing user or unresolved tenant must never
  // reach the data layer, and every lookup below is scoped by both owner and tenant.
  const { tenant, user } = authedContext(req);
  const transaction = await DI.em.findOne(
    Transaction,
    {
      deletedAt: undefined,
      tenantKey: tenant,
      transactionKey: transactionId,
    },
    {
      // A revealed hidden transaction (already id/tenant-scoped) must be editable — e.g.
      // re-categorizing it — without a false not-found. Disable only the hidden filter.
      filters: { [HIDDEN_FILTER]: false },
      populate: ['accountKey', 'appuserTransactionCategories.categoryKey', 'settlementCurrencyKey', 'appuserCurrencyKey', 'transactionTypeKey', ...TRANSFER_DESTINATION_POPULATE],
    },
  );
  if (!transaction) {
    next(new NotFoundError('Transaction not found'));
    return;
  }
  // "Mark as transfer" first: it validates everything it was given before changing anything.
  if (transactionType !== undefined || transferDestination !== undefined) {
    const { typeChanged } = await retypeTransaction(DI.em, { actor: user, destination: transferDestination, tenant, transaction, typeName: transactionType });
    await DI.em.flush();
    // Let transfer matching look at the row again now: a row marked as a transfer may pair with its
    // other half, and one marked as not a transfer leaves its pair (its partner gets its type back).
    if (typeChanged) {
      await DI.em.transactional((em) => reconcileTransfers(em, {
        actorType: TransactionAuditActorType.SYSTEM,
        apply: true,
        from: transaction.transactionDate ?? undefined,
        source: 'transfer-matching',
        tenantKey: tenant.tenantKey,
      }));
    }
  }
  if (categoryKey) {
    const category = await findAssignableCategory(DI.em, tenant, categoryKey);
    if (!category) {
      next(new NotFoundError('Category not found'));
      return;
    }
    const previousCategory = (await applyUserCategorization(DI.em, { actor: user, category, transactions: [transaction] })).get(transaction.transactionKey);
    await TransactionAuditService.log(DI.em, {
      accountKey: transaction.accountKey?.accountKey ?? null,
      actorAppuserKey: user.appuserKey,
      actorType: TransactionAuditActorType.USER,
      appuserKey: user.appuserKey,
      changes: { categoryKey: { from: previousCategory?.categoryKey ?? null, to: category.categoryKey } },
      eventType: TransactionAuditEventType.CATEGORIZED,
      source: 'user-edit',
      tenantKey: tenant.tenantKey,
      transactionKey: transaction.transactionKey,
    });
  }
  // `!== undefined`, not truthiness: an edit to 0 is an edit.
  if (updatedAmount !== undefined) {
    // An edit may not exceed, in the same direction, the amount before any edit: what the bank
    // charged, or what a manual row was entered with. Not the previous edit, or a user who edited
    // -100 to -10 could never correct it to -90.
    if (exceedsUneditedAmount(transaction, updatedAmount)) {
      next(new BadRequestError('Amount cannot be greater than the original amount'));
      return;
    }
    // Run the edit and its running-balance propagation atomically, under a pessimistic
    // write lock on the edited transaction and its account, with every query scoped to this owner,
    // tenant, and account. This prevents partial failures and guarantees balances on other accounts
    // or tenants can never be selected or mutated.
    await DI.em.transactional(async (em) => {
      const lockedTransaction = await em.findOne(
        Transaction,
        {
              deletedAt: undefined,
          tenantKey: tenant,
          transactionKey: transactionId,
        },
        {
          // Same id/tenant-scoped row as the load above; must lock it even when hidden.
          filters: { [HIDDEN_FILTER]: false },
          lockMode: LockMode.PESSIMISTIC_WRITE,
          populate: ['accountKey', 'settlementCurrencyKey', 'appuserCurrencyKey'],
        },
      );
      if (!lockedTransaction) {
        throw new NotFoundError('Transaction not found');
      }
      // Lock the owning account, scoped to this owner and tenant, so the ending-balance write and
      // any concurrent edit on the same account are serialized.
      const account = await em.findOne(
        Account,
        {
          accountKey: lockedTransaction.accountKey!.accountKey,
          deletedAt: undefined,
          tenantKey: tenant,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!account) {
        throw new NotFoundError('Account not found');
      }

      const auditBefore = {
        appuserCurrencyBalance: lockedTransaction.appuserCurrencyBalance,
        balance: lockedTransaction.balance,
        editedSettlementAmount: lockedTransaction.editedSettlementAmount,
      };

      // Edit Amount. The chain helper accumulates using each row's stored `settlementAmount` /
      // `appuserSettlementAmount`, so we update the anchor row in place before asking the helper to
      // recompute the suffix — keeping the Big-decimal arithmetic in the one module that owns it.
      // The pre-edit amounts: the chain needs them to open on an account's oldest row.
      const previous = {
        appuserSettlementAmount: lockedTransaction.appuserSettlementAmount,
        settlementAmount: lockedTransaction.settlementAmount,
      };
      lockedTransaction.uneditedSettlementAmount ??= lockedTransaction.settlementAmount;
      lockedTransaction.editedSettlementAmount = updatedAmount;
      // Through the one rate resolver and `convertMoney`: with no rate, no converted amount is
      // stored (`missing`), never the amount in the settlement currency.
      const converted = await convertWithStatus(em, updatedAmount, lockedTransaction.settlementCurrencyKey!, lockedTransaction.appuserCurrencyKey!, lockedTransaction.transactionDate ?? new Date(), rateScope(tenant));
      lockedTransaction.appuserSettlementAmount = converted.amount;
      lockedTransaction.appuserCurrencyExchangeRate = converted.rate ?? undefined;
      lockedTransaction.fxStatus = converted.fxStatus;
      // Mirror the edit onto the chain's stored `settlementAmount` so the helper accumulates from
      // the new value (the chain is the source of truth for the running-balance recomputation;
      // `editedSettlementAmount` is just a flag for callers that care to distinguish edited rows).
      lockedTransaction.settlementAmount = updatedAmount;

      // Same chain helper as bank sync, anchored on the edited row so rows before it are
      // untouched. The helper returns the new tail so we can update account.balance.
      const { tail } = await recalculateChainFromAccountBalance(
        em,
        account,
        { previous, transactionKey: lockedTransaction.transactionKey },
      );
      account.balance = tail.balance;
      account.appuserCurrencyBalance = tail.appuserCurrencyBalance;
      if (tail.appuserCurrencyBalance === null) account.fxStatus = FxStatus.MISSING;
      em.persist(account);

      // A split follows its transaction's amount: its lines are rescaled (and the row goes back to
      // the review inbox), or the split is removed when it can no longer be kept.
      await reconcileSplitsWithAmount(em, lockedTransaction, { actorAppuserKey: user.appuserKey, actorType: TransactionAuditActorType.USER, source: 'transaction-amount-edit' });

      // Record the money edit atomically with the balance changes (flush:false → commits with this tx).
      await TransactionAuditService.log(
        em,
        {
          accountKey: account.accountKey,
          actorAppuserKey: user.appuserKey,
          actorType: TransactionAuditActorType.USER,
          appuserKey: user.appuserKey,
          changes: {
            appuserCurrencyBalance: { from: auditBefore.appuserCurrencyBalance, to: lockedTransaction.appuserCurrencyBalance },
            balance: { from: auditBefore.balance, to: lockedTransaction.balance },
            editedSettlementAmount: { from: auditBefore.editedSettlementAmount, to: lockedTransaction.editedSettlementAmount },
            settlementAmount: { from: previous.settlementAmount ?? null, to: lockedTransaction.settlementAmount },
          },
          eventType: TransactionAuditEventType.USER_EDIT,
          source: 'transaction-amount-edit',
          tenantKey: tenant.tenantKey,
          transactionKey: lockedTransaction.transactionKey,
        },
        { flush: false },
      );

      // Reflect the mutated values on the entity loaded by the outer request EM for the response.
      transaction.editedSettlementAmount = lockedTransaction.editedSettlementAmount;
      transaction.balance = lockedTransaction.balance;
      transaction.appuserCurrencyBalance = lockedTransaction.appuserCurrencyBalance;
      transaction.reviewed = lockedTransaction.reviewed;
    });
  }

  // A statement override moves the row between credit-card statements without touching its date,
  // its amount or any balance. `null` clears it, so the transaction date decides again.
  if (statementDateOverride !== undefined) {
    transaction.statementDateOverride = statementDateOverride ?? undefined;
    await DI.em.persist(transaction).flush();
  }

  const transformedData = pick(transaction, [
    'transactionKey',
    'transactionDate',
    'statementDateOverride',
    'transactionTypeKey.name',
    'accountKey.accountKey',
    'accountKey.accountName',
    'description',
    'descriptionDirty',
    'settlementAmount',
    'settlementCurrencyKey.code',
    'appuserSettlementAmount',
    'appuserCurrencyKey.code',
    'balance',
    'appuserCurrencyBalance',
    'categories',
    'transactionMerchantKey.name',
    'hidden',
    'reviewed',
    'appuserTransactionCategories',
    'appuserTransactionCategories.categoryKey',
  ]);

  return res.json({ transaction: { ...transformedData, transferDestination: transferDestinationOf(transaction, user.appuserKey) } });
}

export async function updateTransactions(req: Request, res: Response, next: NextFunction) {
  const {
    body: { categoryId, hidden, reviewed, transactionIds },
  } = await zParse(updateTransactionsRequestSchema, req);
  const { tenant, user: authenticatedUser } = authedContext(req);
  const appuser = await DI.em.findOne(Appuser, { appuserKey: authenticatedUser.appuserKey }, { populate: ['onboarding'] });
  if (!appuser) {
    next(new InternalServerError('User not found'));
    return;
  }
  const transactions = await DI.em.find(
    Transaction,
    {
      deletedAt: undefined,
      tenantKey: tenant,
      transactionKey: { $in: transactionIds },
    },
    {
      // This endpoint operates on explicit, already-authorized transactionIds — it must be
      // able to load an already-hidden transaction (e.g. to unhide it), not just visible ones.
      filters: { [HIDDEN_FILTER]: false },
      populate: ['appuserTransactionCategories.categoryKey', 'transactionMerchantKey'],
    },
  );
  if (transactions.length !== transactionIds.length) {
    next(new NotFoundError('Transaction not found'));
    return;
  }
  let category: Category | null = null;
  if (categoryId) {
    category = await findAssignableCategory(DI.em, tenant, categoryId);
    if (!category) {
      next(new NotFoundError('Category not found'));
      return;
    }
  }
  // Bulk categorize persists the assignment and learns the merchant mapping exactly like the
  // single-transaction path — both go through applyUserCategorization, which also hands back each
  // transaction's *original* category so the audit `from` recorded below stays correct.
  const originalCategoryByTransaction = category
    ? await applyUserCategorization(DI.em, { actor: authenticatedUser, category, transactions })
    : new Map<number, Category | undefined>();

  // The `reviewed` flag is uniform across every selected transaction, so this is a single bulk UPDATE
  // rather than one per transaction. The WHERE mirrors the load above exactly (same tenant + soft-delete + id scope), so this does
  // not widen access beyond the authenticated household's transactions.
  // nativeUpdate bypasses the tenant filter, so scope explicitly by tenant (the ids were
  // already validated against the household via the filtered load above).
  const shouldSetReviewed = !!reviewed || !!category;
  // Only include the fields the caller actually intends to change. `hidden` is bidirectional
  // (true/false), unlike `reviewed` which this endpoint only ever sets to true — building this
  // unconditionally would silently reset `reviewed` to false on a hidden-only call.
  const transactionUpdate: { hidden?: boolean; reviewed?: boolean } = {};
  if (shouldSetReviewed) transactionUpdate.reviewed = true;
  if (hidden !== undefined) transactionUpdate.hidden = hidden;
  if (Object.keys(transactionUpdate).length > 0) {
    await DI.em.nativeUpdate(
      Transaction,
      {
        deletedAt: undefined,
        tenantKey: tenant,
        transactionKey: { $in: transactionIds },
      },
      transactionUpdate,
    );
  }

  // Best-effort audit of the bulk review/category/hidden change (one row per transaction).
  const tenantKeyForAudit = tenant.tenantKey;
  for (const transaction of transactions) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (shouldSetReviewed && !transaction.reviewed) {
      changes['reviewed'] = { from: transaction.reviewed, to: true };
    }
    if (hidden !== undefined && transaction.hidden !== hidden) {
      changes['hidden'] = { from: transaction.hidden, to: hidden };
    }
    if (category) {
      const currentCategory = originalCategoryByTransaction.get(transaction.transactionKey);
      changes['categoryKey'] = { from: currentCategory ? currentCategory.categoryKey : null, to: category.categoryKey };
    }
    if (Object.keys(changes).length === 0) continue;
    await TransactionAuditService.log(DI.em, {
      actorAppuserKey: authenticatedUser.appuserKey,
      actorType: TransactionAuditActorType.USER,
      appuserKey: authenticatedUser.appuserKey,
      changes,
      eventType: category ? TransactionAuditEventType.CATEGORIZED : TransactionAuditEventType.USER_EDIT,
      source: 'bulk-update',
      tenantKey: tenantKeyForAudit,
      transactionKey: transaction.transactionKey,
    });
  }

  return res.sendStatus(200);
}

/** The amount before any user edit bounds an edit: same sign, no larger in magnitude. */
function exceedsUneditedAmount(transaction: Pick<Transaction, 'settlementAmount' | 'uneditedSettlementAmount'>, updatedAmount: number): boolean {
  const unedited = transaction.uneditedSettlementAmount ?? transaction.settlementAmount;
  if (unedited == null) return false;
  return (unedited > 0 && updatedAmount > unedited) || (unedited < 0 && updatedAmount < unedited);
}

/**
 * Merchants the household knows only from transactions on another member's private accounts.
 *
 * Merchants are a household-wide list, but a merchant that appears nowhere except on a private
 * account is part of that account's transactions (the privacy carve-out), so the other member
 * must not see it. A transaction is visible on exactly the terms of the Transaction tenant filter:
 * no account, a shared account, or the viewer's own account. Raw SQL, so it carries the tenant
 * predicate itself.
 */
async function findMerchantsSeenOnlyOnOthersPrivateAccounts(tenantKey: number, viewerAppuserKey: number): Promise<number[]> {
  const rows = await sqlQuery(DI.em)
    .selectFrom('transaction as t')
    .leftJoin('account as a', 'a.account_key', 't.account_key')
    .select('t.transaction_merchant_key as merchantKey')
    .where('t.tenant_key', '=', tenantKey)
    .where('t.deleted_at', 'is', null)
    .where('t.transaction_merchant_key', 'is not', null)
    .groupBy('t.transaction_merchant_key')
    .having(sql<boolean>`bool_and(coalesce(a.is_private and a.account_owner_appuser_key <> ${viewerAppuserKey}, false))`)
    .execute();
  return rows.map((row) => row.merchantKey as number);
}
