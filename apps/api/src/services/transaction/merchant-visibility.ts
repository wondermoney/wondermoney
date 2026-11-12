import { sql } from 'kysely';

import { DI } from '@app/app';
import { sqlQuery } from '@app/database/sql';

/**
 * Merchants the household knows only from transactions on another member's private accounts.
 *
 * Merchants are a household-wide list, but a merchant that appears nowhere except on a private
 * account is part of that account's transactions (the privacy carve-out), so the other member
 * must not see it. A transaction is visible on exactly the terms of the Transaction tenant filter:
 * no account, a shared account, or the viewer's own account. Raw SQL, so it carries the tenant
 * predicate itself. `merchantKey` narrows the check to one merchant.
 */
export async function findMerchantsSeenOnlyOnOthersPrivateAccounts(tenantKey: number, viewerAppuserKey: number, merchantKey?: number): Promise<number[]> {
  let query = sqlQuery(DI.em)
    .selectFrom('transaction as t')
    .leftJoin('account as a', 'a.account_key', 't.account_key')
    .select('t.transaction_merchant_key as merchantKey')
    .where('t.tenant_key', '=', tenantKey)
    .where('t.deleted_at', 'is', null)
    .where('t.transaction_merchant_key', 'is not', null);
  if (merchantKey !== undefined) query = query.where('t.transaction_merchant_key', '=', merchantKey);
  const rows = await query
    .groupBy('t.transaction_merchant_key')
    .having(sql<boolean>`bool_and(coalesce(a.is_private and a.account_owner_appuser_key <> ${viewerAppuserKey}, false))`)
    .execute();
  return rows.map((row) => row.merchantKey as number);
}
