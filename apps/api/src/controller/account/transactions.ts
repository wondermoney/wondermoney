import { LockMode, QueryOrder } from '@mikro-orm/core';
import { startOfMonth } from 'date-fns';
import type { NextFunction, Request, Response } from 'express';
import { orderBy, pick } from 'lodash-es';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Category } from '@entity/Category';
import { ExchangeRate } from '@entity/ExchangeRate';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionType } from '@entity/TransactionType';
import { authedContext, authedUser } from '@middleware/authed-context';
import { calculateEffectiveSpendingAmount } from '@service/loan/loan-spending-adjustment.service';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { findAssignableCategory } from '@service/transaction/household-category';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';
import { findManualDuplicate } from '@service/transaction/transaction-dedup.service';
import { listTransactions } from '@service/transaction/transaction-list.service';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';
import { filterExpenseTransactions, getEffectiveAppuserAmount } from '@utils/account-amounts';
import { BadRequestError, InternalServerError, NotFoundError, UnauthorizedError } from '@utils/errors';
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
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    },
    params: { accountId },
  } = await zParse(createTransactionRequestSchema, req);
  const authenticatedUser = authedUser(req);

  try {
    // RAD-346 Phase 2: warn-and-allow duplicate hint (flag-gated, additive). Never blocks the create.
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
      exchangeRate,
      originalAmount,
      originalCurrencyId,
      settlementAmount,
      settlementCurrencyId,
      transactionDate,
      transactionMerchantId,
      transactionMerchantName,
      transactionTypeId,
    });
    if (duplicateMatch) {
      // RAD-394: record that the fingerprint flagged a possible duplicate but we still created the
      // row. Distinct from the sync path's DEDUP_SKIPPED (which skips the create) so RAD-393 can tell
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
    query: { categoryKeys, confidence, cursor, fromDate, includeHidden, limit, toDate, transactionTypes, unreviewedOnly },
  } = await zParse(getAccountTransactionsRequestSchema, req);
  const accountParam = req.params['accountId'];
  const accountKey = Number.parseInt(typeof accountParam === 'string' ? accountParam : '', 10);
  if (!Number.isInteger(accountKey) || accountKey <= 0) throw new BadRequestError('Account id is required');
  const { tenant, user } = authedContext(req);
  const page = await listTransactions({
    cursor,
    filters: { categoryKeys, confidence, fromDate, includeHidden, toDate, transactionTypes, unreviewedOnly },
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
    query: { fromDate, limit, toDate },
  } = await zParse(getCategorySpendingRequestSchema, req);

  const accounts = await DI.em.find(Account, {
    $or: [{ isPrivate: false }, { accountOwnerAppuserKey: user }],
    deletedAt: undefined,
    tenantKey: tenant,
  });
  if (accounts.length === 0) {
    return res.json({ categorySpending: [] });
  }
  const transactions = await DI.em.find(
    Transaction,
    {
      accountKey: { $in: accounts },
      // RAD-audit: this read omitted `deletedAt` entirely, so deleted transactions
      // were counted into per-category spending.
      deletedAt: undefined,
      tenantKey: tenant,
      transactionDate: {
        $gte: fromDate ?? startOfMonth(new Date()),
        ...(toDate && { $lte: toDate }),
      },
    },
    {
      populate: [
        'appuserTransactionCategories.categoryKey',
        'appuserTransactionCategories.categoryKey.parentCategory',
        'appuserCurrencyKey',
      ],
    },
  );
  const loanRepaymentLinks = await DI.em.find(LoanRepaymentLink, {
    deletedAt: undefined,
    transactionKey: { $in: transactions },
  });
  const loanRepaymentLinkMap = new Map<number, LoanRepaymentLink[]>();
  for (const link of loanRepaymentLinks) {
    const transactionKey = link.transactionKey.transactionKey;
    const current = loanRepaymentLinkMap.get(transactionKey);
    if (current) current.push(link);
    else loanRepaymentLinkMap.set(transactionKey, [link]);
  }
  const expenseTransactions = filterExpenseTransactions(transactions);
  // NOTE: we can improve performance by using a Map instead of an object
  // const categorySpending = new Map<[category: string], CategorySpending[string]>();
  // also consider moving to SQL query instead.
  const categorySpending: CategorySpending = {};
  for (const transaction of expenseTransactions) {
    const amount = calculateEffectiveSpendingAmount({
      loanRepaymentLinks: loanRepaymentLinkMap.get(transaction.transactionKey) ?? [],
      transactionAmount: getEffectiveAppuserAmount(transaction),
    });
    const trxCategory = transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
    if (!trxCategory) {
      // This transaction has no category, so we add it to the Uncategorized category
      if ('Uncategorized' in categorySpending) {
        categorySpending['Uncategorized'].amount += Math.abs(amount);
        categorySpending['Uncategorized'].numTransactions += 1;
      } else {
        categorySpending['Uncategorized'] = {
          amount: Math.abs(amount),
          bgColor: '#000000',
          categoryKey: -1,
          childCategories: {},
          currency: transaction.appuserCurrencyKey?.code,
          isSystemCategory: true,
          numTransactions: 1,
          textColor: '#FFFFFF',
        };
      }
      continue;
    }
    const parentCategory = trxCategory.parentCategory;
    if (!parentCategory) {
      // This is a parent category (the transaction category doesnt have a parent category)
      categorySpending[trxCategory.name] = {
        amount: Math.abs(amount),
        bgColor: trxCategory.bgColor,
        categoryKey: trxCategory.categoryKey,
        childCategories: {},
        currency: transaction.appuserCurrencyKey?.code,
        icon: trxCategory.icon,
        isSystemCategory: trxCategory.isSystemCategory,
        numTransactions: 1,
        textColor: trxCategory.textColor,
      };
    } else {
      // This is a child category (the transaction category has a parent category)
      if (parentCategory.name in categorySpending) {
        // The parent category is already in the categorySpending object
        const parentSpending = categorySpending[parentCategory.name];
        if (!parentSpending) continue; // TypeScript type guard
        parentSpending.amount += Math.abs(amount);
        parentSpending.numTransactions += 1;
        if (trxCategory.name in parentSpending.childCategories) {
          // The child category is already in the categorySpending object
          const childSpending = parentSpending.childCategories[trxCategory.name];
          if (!childSpending) continue; // TypeScript type guard
          childSpending.amount += Math.abs(amount);
          childSpending.numTransactions += 1;
        } else {
          // The child category is not in the categorySpending object
          parentSpending.childCategories[trxCategory.name] = {
            amount: Math.abs(amount),
            bgColor: trxCategory.bgColor,
            categoryKey: trxCategory.categoryKey,
            currency: transaction.appuserCurrencyKey?.code,
            icon: trxCategory.icon,
            isSystemCategory: trxCategory.isSystemCategory,
            numTransactions: 1,
            textColor: trxCategory.textColor,
          };
        }
      } else {
        // The parent category is not in the categorySpending object
        categorySpending[parentCategory.name] = {
          amount: Math.abs(amount),
          bgColor: parentCategory.bgColor,
          categoryKey: parentCategory.categoryKey,
          childCategories: {
            [trxCategory.name]: {
              amount: Math.abs(amount),
              bgColor: trxCategory.bgColor,
              categoryKey: trxCategory.categoryKey,
              currency: transaction.appuserCurrencyKey?.code,
              icon: trxCategory.icon,
              isSystemCategory: trxCategory.isSystemCategory,
              numTransactions: 1,
              textColor: trxCategory.textColor,
            },
          },
          currency: transaction.appuserCurrencyKey?.code,
          icon: parentCategory.icon,
          isSystemCategory: parentCategory.isSystemCategory,
          numTransactions: 1,
          textColor: parentCategory.textColor,
        };
      }
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

  return res.json({ categorySpending: limitedData });
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
  // RAD-25: an explicitly-requested transaction (already id/tenant-scoped) must be loadable even
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
  const transformedData = history.map((entry) =>
    pick(entry, ['transactionAuditLogKey', 'eventType', 'actorType', 'actorAppuserKey.appuserKey', 'source', 'changes', 'createdAt']),
  );
  return res.json({ history: transformedData });
}

export async function getTransactionMerchants(req: Request, res: Response) {
  const {
    query: { limit, search },
  } = await zParse(getTransactionMerchantsRequestSchema, req);
  const normalizedSearch = search ? normalizeMerchantName(search) : undefined;

  const transactionMerchants = await DI.em.find(
    TransactionMerchant,
    {
      deletedAt: undefined,
      ...(normalizedSearch ? { normalizedName: { $like: `%${normalizedSearch}%` } } : {}),
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
    query: { accountKeys, categoryKeys, confidence, cursor, fromDate, includeHidden, limit, toDate, transactionTypes, unreviewedOnly },
  } = await zParse(getTransactionsRequestSchema, req);
  const { tenant, user } = authedContext(req);
  const page = await listTransactions({
    cursor,
    filters: { accountKeys, categoryKeys, confidence, fromDate, includeHidden, toDate, transactionTypes, unreviewedOnly },
    limit,
    scope: 'all-accounts',
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  });
  return res.json(page);
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
    body: { categoryKey, updatedAmount },
    params: { transactionId },
  } = await zParse(updateTransactionRequestSchema, req);
  // RAD-218: authorize before any database access — a missing user or unresolved tenant must never
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
      // RAD-25: a revealed hidden transaction (already id/tenant-scoped) must be editable — e.g.
      // re-categorizing it — without a false not-found. Disable only the hidden filter.
      filters: { [HIDDEN_FILTER]: false },
      populate: ['accountKey', 'appuserTransactionCategories.categoryKey', 'settlementCurrencyKey', 'appuserCurrencyKey'],
    },
  );
  if (!transaction) {
    next(new NotFoundError('Transaction not found'));
    return;
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
  if (updatedAmount) {
    // Validation
    if (
      transaction.settlementAmount !== undefined &&
      ((transaction.settlementAmount > 0 && updatedAmount > transaction.settlementAmount) ||
        (transaction.settlementAmount < 0 && updatedAmount < transaction.settlementAmount))
    ) {
      next(new BadRequestError('Amount cannot be greater than the original amount'));
      return;
    }
    // RAD-218: run the edit and its running-balance propagation atomically, under a pessimistic
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
          // RAD-25: same id/tenant-scoped row as the load above; must lock it even when hidden.
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
      lockedTransaction.editedSettlementAmount = updatedAmount;
      const shouldConvertAmount = lockedTransaction.settlementCurrencyKey!.code !== lockedTransaction.appuserCurrencyKey!.code;
      if (shouldConvertAmount) {
        const exchangeRate = await em.findOne(
          ExchangeRate,
          {
            date: { $lte: lockedTransaction.transactionDate },
            fromCurrency: lockedTransaction.settlementCurrencyKey!,
            toCurrency: lockedTransaction.appuserCurrencyKey!,
          },
          {
            orderBy: { date: QueryOrder.DESC },
          },
        );
        if (exchangeRate) {
          lockedTransaction.appuserSettlementAmount = updatedAmount * exchangeRate.rate;
        } else {
          lockedTransaction.appuserSettlementAmount = updatedAmount;
        }
      } else {
        lockedTransaction.appuserSettlementAmount = updatedAmount;
      }
      // Mirror the edit onto the chain's stored `settlementAmount` so the helper accumulates from
      // the new value (the chain is the source of truth for the running-balance recomputation;
      // `editedSettlementAmount` is just a flag for callers that care to distinguish edited rows).
      lockedTransaction.settlementAmount = updatedAmount;

      // RAD-564: same chain helper as bank sync, anchored on the edited row so rows before it are
      // untouched. The helper returns the new tail so we can update account.balance.
      const { tail } = await recalculateChainFromAccountBalance(
        em,
        account,
        { transactionKey: lockedTransaction.transactionKey },
      );
      account.balance = tail.balance;
      account.appuserCurrencyBalance = tail.appuserCurrencyBalance;
      em.persist(account);

      // RAD-346: record the money edit atomically with the balance changes (flush:false → commits with this tx).
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
    });
  }

  const transformedData = pick(transaction, [
    'transactionKey',
    'transactionDate',
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

  return res.json({ transaction: transformedData });
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
      // RAD-25: this endpoint operates on explicit, already-authorized transactionIds — it must be
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
  // RAD-411: bulk categorize persists the assignment and learns the merchant mapping exactly like the
  // single-transaction path — both go through applyUserCategorization, which also hands back each
  // transaction's *original* category so the audit `from` recorded below stays correct.
  const originalCategoryByTransaction = category
    ? await applyUserCategorization(DI.em, { actor: authenticatedUser, category, transactions })
    : new Map<number, Category | undefined>();

  // RAD-271: the `reviewed` flag is uniform across every selected transaction, so collapse what used to be
  // one `UPDATE ... WHERE transaction_key = :id` (each in its own BEGIN/COMMIT — a classic N+1) into a single
  // bulk UPDATE. The WHERE mirrors the load above exactly (same tenant + soft-delete + id scope), so this does
  // not widen access beyond the authenticated household's transactions.
  // nativeUpdate bypasses the tenant filter, so scope explicitly by tenant (the ids were
  // already validated against the household via the filtered load above). RAD-343.
  const shouldSetReviewed = !!reviewed || !!category;
  // RAD-25: only include the fields the caller actually intends to change. `hidden` is bidirectional
  // (true/false), unlike `reviewed` which this endpoint only ever sets to true — building this
  // unconditionally (as before) would silently reset `reviewed` to false on a hidden-only call.
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

  // RAD-346: best-effort audit of the bulk review/category/hidden change (one row per transaction).
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
