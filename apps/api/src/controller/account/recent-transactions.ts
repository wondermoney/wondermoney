import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { excludeExpired } from '@service/transaction/transaction-status';
import { InternalServerError, NotFoundError } from '@utils/errors';
import { getRecentTransactionsRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

/**
 * Least-privilege recent-transactions summary for the mobile account
 * detail. Returns at most the five newest entries for one authorized account with an
 * explicit shape and NO ids, dirty descriptions, review state, logos, or editable
 * metadata. A persisted row also carries what its leading mark needs and nothing more:
 * its category's icon and colours (not the category's id or name) and whether it is one
 * side of a transfer. The legacy transaction endpoint remains for the web editor and is
 * never a mobile fallback.
 */

export const RECENT_TRANSACTIONS_LIMIT = 5;

interface RecentTransactionCategoryMarkDto {
  bgColor: null | string;
  icon: null | string;
  textColor: null | string;
}

interface RecentTransactionDto {
  amount: null | number;
  /** Persisted rows only: the first category's icon and colours, `null` when uncategorised. */
  category?: null | RecentTransactionCategoryMarkDto;
  currencyCode: null | string;
  displayName: null | string;
  entryType: RecentTransactionEntryType;
  occurredAt: null | string;
  /** Persisted rows only: the row is one side of a transfer between two accounts. */
  transfer?: boolean;
}

const TRANSFER_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT']);

type RecentTransactionEntryType = 'persisted_transaction' | 'synthetic_initial_balance';

/** Manual/offline accounts have neither an Open Banking requisition nor a bank account id. */
function isManualAccount(account: Account): boolean {
  return account.nordigenRequisitionKey == null && account.accountId == null;
}

/**
 * "Normalized description" for display: trim and collapse internal whitespace while
 * preserving case. Deliberately distinct from merchant-matching normalization, which
 * lowercases for dedup and would produce poor display text.
 */
export async function getRecentTransactions(req: Request, res: Response) {
  const {
    params: { accountId },
  } = await zParse(getRecentTransactionsRequestSchema, req);
  if (!req.user || !req.tenant) {
    throw new InternalServerError('Authenticated user and tenant are required');
  }

  // Single owner + tenant + active-row predicate. Missing, deleted, wrong-owner, and
  // wrong-tenant accounts all resolve to the same generic not-found outcome.
  const account = await DI.em.findOne(
    Account,
    {
      accountKey: accountId,
      accountOwnerAppuserKey: req.user,
      deletedAt: undefined,
      tenantKey: req.tenant,
    },
    { populate: ['currencyKey'] },
  );
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  const transactions = await DI.em.find(
    Transaction,
    // A retracted (EXPIRED) row never moved money, so it is not recent activity.
    excludeExpired({
      accountKey: account,
      appuserKey: req.user,
      deletedAt: undefined,
    }),
    {
      limit: RECENT_TRANSACTIONS_LIMIT,
      orderBy: { transactionDate: QueryOrder.DESC_NULLS_LAST, transactionKey: QueryOrder.DESC },
      populate: ['settlementCurrencyKey', 'transactionMerchantKey', 'transactionTypeKey', 'appuserTransactionCategories.categoryKey'],
    },
  );

  // A manual account with no persisted activity yields a single synthetic opening row.
  // Never for Open Banking accounts, and never when real transactions exist.
  if (transactions.length === 0 && isManualAccount(account)) {
    return res.json({ transactions: [buildSyntheticInitialBalance(account)] });
  }

  return res.json({ transactions: transactions.map(mapRecentTransaction) });
}

function buildSyntheticInitialBalance(account: Account): RecentTransactionDto {
  return {
    amount: toFiniteAmount(account.balance),
    currencyCode: account.currencyKey.code,
    displayName: null,
    entryType: 'synthetic_initial_balance',
    occurredAt: account.createdAt.toISOString(),
  };
}

function mapRecentTransaction(transaction: Transaction): RecentTransactionDto {
  return {
    // Edited settlement amount, then settlement amount, then null. Zero is preserved.
    amount: toFiniteAmount(transaction.editedSettlementAmount ?? transaction.settlementAmount),
    category: resolveCategoryMark(transaction),
    currencyCode: transaction.settlementCurrencyKey?.code ?? null,
    displayName: resolveDisplayName(transaction),
    entryType: 'persisted_transaction',
    occurredAt: transaction.transactionDate ? transaction.transactionDate.toISOString() : null,
    transfer: TRANSFER_TYPES.has(transaction.transactionTypeKey?.name.trim().toUpperCase() ?? ''),
  };
}

/** The first assigned category's icon and colours, as the transactions list reads them. */
function normalizeDisplayDescription(description: string | undefined): null | string {
  if (description === undefined) return null;
  const normalized = description.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function resolveCategoryMark(transaction: Transaction): null | RecentTransactionCategoryMarkDto {
  const [assignment] = transaction.appuserTransactionCategories.getItems();
  const category = assignment?.categoryKey;
  if (!category) return null;
  return { bgColor: category.bgColor, icon: category.icon ?? null, textColor: category.textColor };
}

/** Numeric columns can arrive as strings from the driver; keep zero, drop non-finite. */
function toFiniteAmount(value: null | number | string | undefined): null | number {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Server-chosen precedence: merchant name → normalized (clean) description → null. */
function resolveDisplayName(transaction: Transaction): null | string {
  const merchantName = transaction.transactionMerchantKey?.name.trim();
  if (merchantName !== undefined && merchantName.length > 0) return merchantName;
  return normalizeDisplayDescription(transaction.description);
}
