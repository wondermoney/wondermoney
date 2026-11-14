import type { EntityManager, FilterQuery } from '@mikro-orm/core';
import type { Request } from 'express';

import { visibleAccountCond } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import { AccountShareAccess } from '@entity/AccountShare';
import { HouseholdRole } from '@entity/AppuserTenant';
import { ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';

import { accountAudienceSql } from './account-visibility-sql';

export { accountAudienceSql, visibleAccountSql } from './account-visibility-sql';

/**
 * Who may see and who may change an account, decided in one place.
 *
 * - A shared account (`isPrivate = false`): every member sees it and changes it.
 * - A private account: its owner and the members with an `AccountShare` row see it; the owner and
 *   the members whose row says `write` change it. Everyone else does not see it at all: it is
 *   absent from every list, detail and aggregate, as if it did not exist (a 404, never a 403).
 * - A household viewer reads only, whatever the account or the share says.
 *
 * Seeing is enforced by the tenant filter (`visibleAccountCond`) and, for hand-written SQL, by
 * {@link visibleAccountSql}. Changing is enforced by {@link assertAccountWritable} on every write
 * to an account or its data (transactions, tags, splits, reimbursements, installments, imports,
 * bank links, rules applied): a member who only reads gets 403 `account_read_only`.
 *
 * A member who leaves or is removed is no longer in the household, so they see none of it. Their
 * private accounts stay, with their shares: the members they shared one with keep their access,
 * and nobody else gains any — not even the household owner. A share is changed by the account's
 * owner or the household owner, among the members who can see the account.
 */
export type AccountAccess = 'owner' | 'read' | 'write';

/** The member asking. `householdRole` caps a viewer at read; the route stack sets it (`req.householdRole`). */
export interface AccountActor {
  appuserKey: number;
  householdRole?: HouseholdRole;
  tenantKey: number;
}

/** The parts of an account the rule reads. */
export interface AccountAccessFacts {
  isPrivate: boolean;
  ownerAppuserKey: null | number;
  /** The actor's own share on it, if any. */
  share: AccountShareAccess | null;
}

/** The actor's access to an account, or null when they may not see it. */
export function resolveAccountAccess(facts: AccountAccessFacts, actor: Pick<AccountActor, 'appuserKey' | 'householdRole'>): AccountAccess | null {
  const access = ((): AccountAccess | null => {
    if (facts.ownerAppuserKey === actor.appuserKey) return 'owner';
    if (!facts.isPrivate) return 'write';
    if (facts.share === AccountShareAccess.WRITE) return 'write';
    if (facts.share === AccountShareAccess.READ) return 'read';
    return null;
  })();
  if (access && actor.householdRole === HouseholdRole.VIEWER) return 'read';
  return access;
}

/** Whether this access lets the member change the account and its data. */
export const canWrite = (access: AccountAccess | null): access is 'owner' | 'write' => access === 'owner' || access === 'write';

/** The actor of an authenticated request. */
export function accountActor(req: Request): AccountActor {
  if (!req.user || !req.tenant) throw new Error('accountActor needs an authenticated, tenant-resolved request');
  return { appuserKey: req.user.appuserKey, householdRole: req.householdRole, tenantKey: req.tenant.tenantKey };
}

/**
 * MikroORM: the accounts `appuserKey` may change: shared ones, their own, and private ones shared
 * with them for `write`. Their household role is the caller's to check (a viewer changes none).
 */
export function writableAccountWhere(appuserKey: number): { $or: FilterQuery<Account>[] } {
  return { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: appuserKey }, { shares: { $some: { access: AccountShareAccess.WRITE, appuserKey } } }] } as { $or: FilterQuery<Account>[] };
}

/** MikroORM: the accounts `appuserKey` may see (the tenant filter's own rule, for queries that turn it off). */
export function visibleAccountWhere(appuserKey: number): { $or: FilterQuery<Account>[] } {
  return visibleAccountCond(appuserKey) as { $or: FilterQuery<Account>[] };
}

/** The TypeScript twin of {@link accountAudienceSql}. */
export function accountAudience(account: { isPrivate: boolean; ownerAppuserKey: null | number }, sharedWith: readonly number[]): string {
  if (!account.isPrivate) return '*';
  const members = new Set(sharedWith);
  if (account.ownerAppuserKey != null) members.add(account.ownerAppuserKey);
  return [...members].sort((a, b) => a - b).join(',');
}

/** The audience text of each account, by key (see {@link accountAudienceSql}). Accounts of any household; a system read. */
interface AccessRow {
  access: AccountShareAccess | null;
  account_key: number;
  account_owner_appuser_key: null | number;
  is_private: boolean;
}

export async function loadAccountAudiences(em: EntityManager, accountKeys: readonly number[]): Promise<Map<number, string>> {
  const keys = [...new Set(accountKeys)].filter((key) => Number.isSafeInteger(key));
  if (keys.length === 0) return new Map();
  const rows = (await em.getConnection().execute(
    `select a."account_key", ${accountAudienceSql('a')} as audience from "account" a where a."account_key" in (?)`,
    [keys],
    'all',
    em.getTransactionContext(),
  )) as { account_key: number; audience: string }[];
  return new Map(rows.map((row) => [row.account_key, row.audience]));
}

/**
 * The actor's access to each of the accounts, by key. An account of another household, a deleted
 * one, or one the actor may not see is absent. One query, whatever the tenant filter says.
 */
export async function loadAccountAccess(em: EntityManager, accountKeys: readonly number[], actor: AccountActor): Promise<Map<number, AccountAccess>> {
  const keys = [...new Set(accountKeys)].filter((key) => Number.isSafeInteger(key));
  const result = new Map<number, AccountAccess>();
  if (keys.length === 0) return result;
  const rows = (await em.getConnection().execute(
    `select a."account_key", a."is_private", a."account_owner_appuser_key", share."access"
     from "account" a
     left join "account_share" share on share."account_key" = a."account_key" and share."appuser_key" = ? and share."deleted_at" is null
     where a."account_key" in (?) and a."tenant_key" = ? and a."deleted_at" is null`,
    [actor.appuserKey, keys, actor.tenantKey],
    'all',
    em.getTransactionContext(),
  )) as AccessRow[];
  for (const row of rows) {
    const access = resolveAccountAccess({ isPrivate: row.is_private, ownerAppuserKey: row.account_owner_appuser_key, share: row.access }, actor);
    if (access) result.set(row.account_key, access);
  }
  return result;
}

/** The actor's access to one account, or null when they may not see it. */
export async function accountAccessOf(em: EntityManager, accountKey: number, actor: AccountActor): Promise<AccountAccess | null> {
  return (await loadAccountAccess(em, [accountKey], actor)).get(accountKey) ?? null;
}

export const ACCOUNT_READ_ONLY_MESSAGE = 'You can view this account but not change it.';

const keyOf = (account: number | Pick<Account, 'accountKey'>) => (typeof account === 'number' ? account : account.accountKey);

/**
 * Refuse a write to the account's data unless the actor may change it: 404 when they may not see
 * it (as a hidden account answers everywhere), 403 `account_read_only` when they only read it.
 */
export async function assertAccountWritable(em: EntityManager, account: number | Pick<Account, 'accountKey'>, actor: AccountActor): Promise<void> {
  await assertAccountsWritable(em, [keyOf(account)], actor);
}

/** {@link assertAccountWritable} for several accounts at once: every one must be writable. */
export async function assertAccountsWritable(em: EntityManager, accounts: readonly (number | Pick<Account, 'accountKey'>)[], actor: AccountActor): Promise<void> {
  const keys = [...new Set(accounts.map(keyOf))];
  if (keys.length === 0) return;
  const access = await loadAccountAccess(em, keys, actor);
  for (const key of keys) {
    const level = access.get(key) ?? null;
    if (!level) throw new NotFoundError(`Account not found: ${key}`);
    if (!canWrite(level)) throw new ForbiddenError(ACCOUNT_READ_ONLY_MESSAGE, ERROR_CODE.ACCOUNT_READ_ONLY);
  }
}

/** Of these accounts, the ones the actor may change. For bulk writes that skip what they may only read. */
export async function writableAccountKeys(em: EntityManager, accountKeys: readonly number[], actor: AccountActor): Promise<Set<number>> {
  const access = await loadAccountAccess(em, accountKeys, actor);
  return new Set([...access].filter(([, level]) => canWrite(level)).map(([key]) => key));
}

/** The keys of the accounts shared with the member (any access), for in-memory visibility checks. */
export async function loadSharedAccountKeys(em: EntityManager, actor: Pick<AccountActor, 'appuserKey' | 'tenantKey'>): Promise<Set<number>> {
  const rows = (await em.getConnection().execute(
    'select "account_key" from "account_share" where "appuser_key" = ? and "tenant_key" = ? and "deleted_at" is null',
    [actor.appuserKey, actor.tenantKey],
    'all',
    em.getTransactionContext(),
  )) as { account_key: number }[];
  return new Set(rows.map((row) => row.account_key));
}

/**
 * The visibility rule on a loaded account: shared, or the member's own, or shared with them
 * (`sharedAccountKeys` from {@link loadSharedAccountKeys}). The caller checks the household.
 */
export function isAccountVisibleTo(
  account: { accountKey?: number; accountOwnerAppuserKey?: null | { appuserKey?: number }; isPrivate?: boolean },
  appuserKey: number | undefined,
  sharedAccountKeys: ReadonlySet<number>,
): boolean {
  if (!account.isPrivate) return true;
  if (appuserKey === undefined) return false;
  if (account.accountOwnerAppuserKey?.appuserKey === appuserKey) return true;
  return account.accountKey !== undefined && sharedAccountKeys.has(account.accountKey);
}

/** The account of each transaction (when it has one) must be writable; see {@link assertAccountWritable}. */
export async function assertTransactionsWritable(em: EntityManager, transactions: readonly { accountKey?: null | Pick<Account, 'accountKey'> }[], actor: AccountActor): Promise<void> {
  await assertAccountsWritable(em, transactions.flatMap((transaction) => (transaction.accountKey ? [transaction.accountKey.accountKey] : [])), actor);
}

/** Of these transactions, the ones the actor may change: no account, or a writable one. For writes over a filter. */
export async function onlyWritableTransactions<T extends { accountKey?: null | Pick<Account, 'accountKey'> }>(em: EntityManager, transactions: readonly T[], actor: AccountActor): Promise<T[]> {
  const writable = await writableAccountKeys(em, transactions.flatMap((transaction) => (transaction.accountKey ? [transaction.accountKey.accountKey] : [])), actor);
  return transactions.filter((transaction) => !transaction.accountKey || writable.has(transaction.accountKey.accountKey));
}

/**
 * Refuse a write to the transaction unless the actor may change its account. A transaction the
 * actor cannot see, or with no account, is left to the caller (its own 404, or no account rule).
 */
export async function assertTransactionWritable(em: EntityManager, transactionKey: number, actor: AccountActor): Promise<void> {
  const rows = (await em.getConnection().execute(
    'select "account_key" from "transaction" where "transaction_key" = ? and "tenant_key" = ? and "deleted_at" is null',
    [transactionKey, actor.tenantKey],
    'all',
    em.getTransactionContext(),
  )) as { account_key: null | number }[];
  const accountKey = rows[0]?.account_key;
  if (accountKey == null) return;
  await assertAccountWritable(em, accountKey, actor);
}
