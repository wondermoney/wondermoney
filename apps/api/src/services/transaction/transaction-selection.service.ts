import { type EntityManager, type Populate, QueryOrder } from '@mikro-orm/core';
import type { z } from 'zod';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { BadRequestError, ERROR_CODE, NotFoundError } from '@utils/errors';
import { BULK_TRANSACTION_LIMIT, type getTransactionsRequestSchema } from '@validators/account';

import { buildTransactionWhere, type TransactionFilterInput } from './transaction-total.service';

/** The list's filters as `getTransactionsRequestSchema` parses them, without its paging. */
export type TransactionListFilter = Omit<z.infer<typeof getTransactionsRequestSchema>['query'], 'cursor' | 'includeEmptyAccounts' | 'limit'>;

/** Which transactions a bulk request acts on: a list of ids, or every row a list filter matches. */
export interface SelectionViewer {
  tenant: Tenant;
  viewerAppuserKey: number;
}

export type TransactionSelection = { filter: TransactionListFilter; transactionIds?: undefined } | { filter?: undefined; transactionIds: number[] };

/** The list's parsed filters as `buildTransactionWhere` takes them, named as `GET /v1/account/transaction` maps them. */
export function toTransactionFilterInput(filter: TransactionListFilter): TransactionFilterInput {
  const { accountKeys, categoryKeys, confidence, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, memberCurrency, merchantKeys, statuses, tagKeys, timezone, toDate, transactionTypes, unreviewedOnly } = filter;
  return { accountKeys, categoryKeys, confidence, direction, excludeNonSpending, excludeTransfers, fromDate, includeHidden, memberCurrencyCode: memberCurrency, merchantKeys, statuses, tagKeys, timeZone: timezone, toDate, transactionTypes, unreviewedOnly };
}

/**
 * Load the transactions a bulk request selects, as entities of `em`.
 *
 * - **By id**: each id must be a live row the member can see. The request's tenant filter applies
 *   (another household's rows, and the other member's private-account rows, are not found), with
 *   only the hidden filter off, so a hidden row can be unhidden. Any id not found is a 404 for the
 *   whole request, the same answer for "deleted", "not yours" and "never existed".
 * - **By filter**: exactly the rows `GET /v1/account/transaction` lists for the member with those
 *   filters (`buildTransactionWhere`, whose tenant and privacy predicates are explicit and hold
 *   without the ORM filter too). Hidden rows only with `includeHidden`, as in the list. The list's
 *   synthetic opening-balance rows are not transactions and are never selected.
 *
 * Either way at most {@link BULK_TRANSACTION_LIMIT} rows. A filter matching more is refused
 * (`bulk_selection_too_large`) rather than cut to an arbitrary 5,000: the client asked for every
 * matching row and would otherwise be told it got them.
 */
export async function loadTransactionSelection<Hint extends string = never>(
  em: EntityManager,
  viewer: SelectionViewer,
  selection: TransactionSelection,
  options: { populate?: Populate<Transaction, Hint> } = {},
): Promise<Transaction[]> {
  if (selection.transactionIds !== undefined) {
    const transactionIds = [...new Set(selection.transactionIds)];
    const transactions = await em.find(
      Transaction,
      { deletedAt: undefined, tenantKey: viewer.tenant, transactionKey: { $in: transactionIds } },
      { filters: { [HIDDEN_FILTER]: false }, populate: options.populate },
    );
    if (transactions.length !== transactionIds.length) throw new NotFoundError('Transaction not found');
    return transactions;
  }

  const input = toTransactionFilterInput(selection.filter);
  const where = buildTransactionWhere(input, { tenantKey: viewer.tenant.tenantKey, viewerAppuserKey: viewer.viewerAppuserKey });
  const transactions = await em.find(Transaction, where, {
    ...(input.includeHidden ? { filters: { [HIDDEN_FILTER]: false } } : {}),
    // One past the cap, so a selection that is too large is known without counting it first.
    limit: BULK_TRANSACTION_LIMIT + 1,
    orderBy: { transactionDate: QueryOrder.ASC, transactionKey: QueryOrder.ASC },
    populate: options.populate,
  });
  if (transactions.length > BULK_TRANSACTION_LIMIT) {
    throw new BadRequestError(`The filter matches more than ${BULK_TRANSACTION_LIMIT} transactions; narrow it and try again`, ERROR_CODE.BULK_SELECTION_TOO_LARGE);
  }
  return transactions;
}
