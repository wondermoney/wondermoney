import type { EntityManager } from '@mikro-orm/postgresql';

import { AppuserTenant } from '@entity/AppuserTenant';
import { BadRequestError } from '@utils/errors';

/**
 * Member attribution: whose money an account or a transaction is, for reporting ("who spent
 * this?") and the member filter. It is never a visibility rule: who sees a row is decided by
 * `services/account/account-access.ts` (privacy and per-account shares), and a member filter only
 * narrows the rows the viewer already sees. Filtering by another member never shows a private
 * account of theirs that is not shared with the viewer.
 *
 * The rule, the same in SQL ({@link transactionAttributionSql}) and JavaScript
 * ({@link transactionAttributionOf}):
 *
 * - A transaction attributed to a member (`Transaction.attributedAppuserKey`) is that member's.
 * - A transaction attributed to Shared (`Transaction.attributedToShared`) is the household's.
 * - Otherwise it follows its account: a joint account's (`Account.isJoint`) is Shared, any other
 *   is its owner's.
 * - Someone who is no longer an active member of the household is no one's attribution: their
 *   rows count as Shared. So the active members and Shared always split the household's rows
 *   between them, and the per-member totals plus Shared add up to the household total.
 *
 * Defaults for existing data: no account is joint and no transaction carries an attribution, so
 * every row belongs to its account's owner until a member changes it.
 */
export const SHARED_MEMBER = 'shared';

/** A member's appuser key, or null for Shared. */
export type Attribution = null | number;

/** Which attributions to keep: these members, and Shared when `shared` is set. */
export interface MemberFilter {
  appuserKeys: readonly number[];
  shared: boolean;
}

/** A member filter value as the API reads it: a member's appuser key, or `shared`. */
export const MEMBER_FILTER_VALUE = /^(?:[1-9]\d*|shared)$/u;

/** `memberKeys` as parsed strings into a filter; absent or empty is no filter at all. */
export function parseMemberFilter(values: readonly string[] | undefined): MemberFilter | undefined {
  if (!values || values.length === 0) return undefined;
  const appuserKeys = [...new Set(values.filter((value) => value !== SHARED_MEMBER).map(Number))];
  if (appuserKeys.some((key) => !Number.isSafeInteger(key) || key <= 0)) throw new BadRequestError('memberKeys must be member keys or "shared"');
  return { appuserKeys, shared: values.includes(SHARED_MEMBER) };
}

/** The filter for one member (`?member=` on net worth), or Shared. */
export interface AttributionAccount {
  isJoint: boolean;
  ownerAppuserKey: null | number | undefined;
}

export interface AttributionTransaction {
  attributedAppuserKey: null | number | undefined;
  attributedToShared: boolean;
}

export function singleMemberFilter(value: number | typeof SHARED_MEMBER): MemberFilter {
  return value === SHARED_MEMBER ? { appuserKeys: [], shared: true } : { appuserKeys: [value], shared: false };
}

/** An account's attribution: Shared when joint, else its owner while they are an active member. */
export function accountAttributionOf(account: AttributionAccount, activeMembers: ReadonlySet<number>): Attribution {
  if (account.isJoint || account.ownerAppuserKey == null) return null;
  return activeMembers.has(account.ownerAppuserKey) ? account.ownerAppuserKey : null;
}

/** A transaction's attribution: its own when it has one, else its account's. */
export function matchesMemberFilter(attribution: Attribution, filter: MemberFilter | undefined): boolean {
  if (!filter) return true;
  return attribution === null ? filter.shared : filter.appuserKeys.includes(attribution);
}

export function transactionAttributionOf(transaction: AttributionTransaction, account: AttributionAccount, activeMembers: ReadonlySet<number>): Attribution {
  if (transaction.attributedAppuserKey != null) return activeMembers.has(transaction.attributedAppuserKey) ? transaction.attributedAppuserKey : null;
  if (transaction.attributedToShared) return null;
  return accountAttributionOf(account, activeMembers);
}

function integer(value: number, name: string): string {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`);
  return String(value);
}

function sqlAlias(alias: string): string {
  if (!/^[a-z_]\w*$/iu.test(alias)) throw new TypeError(`Not a table alias: ${alias}`);
  return `"${alias}"`;
}

/** SQL: `keyExpression` when it is an active member of the household, else null. */
function activeMemberSql(keyExpression: string, tenantKey: number): string {
  return `(select attribution_member."appuser_key" from "appuser_tenant" attribution_member
    where attribution_member."tenant_key" = ${integer(tenantKey, 'tenantKey')} and attribution_member."record_active" = true
      and attribution_member."deleted_at" is null and attribution_member."appuser_key" = ${keyExpression} limit 1)`;
}

/** SQL: the account's attribution (an appuser key, or null for Shared), as {@link accountAttributionOf}. */
export function accountAttributionSql(accountAlias: string, tenantKey: number): string {
  const account = sqlAlias(accountAlias);
  return activeMemberSql(`(case when ${account}."is_joint" then null else ${account}."account_owner_appuser_key" end)`, tenantKey);
}

/** SQL: the transaction's attribution (an appuser key, or null for Shared), as {@link transactionAttributionOf}. */
export function transactionAttributionSql(rowAlias: string, accountAlias: string, tenantKey: number): string {
  const row = sqlAlias(rowAlias);
  const account = sqlAlias(accountAlias);
  return activeMemberSql(
    `(case when ${row}."attributed_appuser_key" is not null then ${row}."attributed_appuser_key"
      when ${row}."attributed_to_shared" or ${account}."is_joint" then null
      else ${account}."account_owner_appuser_key" end)`,
    tenantKey,
  );
}

/** SQL: the attribution expression passes the filter. Keys are inlined as validated integers. */
export function memberFilterSql(attribution: string, filter: MemberFilter): string {
  const branches: string[] = [];
  if (filter.appuserKeys.length > 0) branches.push(`${attribution} = any(array[${filter.appuserKeys.map((key) => integer(key, 'memberKeys')).join(', ')}]::int[])`);
  if (filter.shared) branches.push(`${attribution} is null`);
  return branches.length === 0 ? 'false' : `(${branches.join(' or ')})`;
}

/**
 * The portfolios a member filter keeps. A portfolio is its owner's outright: it has no joint switch
 * and no ownership shares, and one whose owner left the household is Shared. Portfolios belong to
 * the household, so this only narrows the household's list; it never decides who sees one.
 */
export async function portfoliosOfMembers<T extends { portfolioOwnerAppuserKey: { appuserKey: number } }>(
  em: EntityManager,
  tenantKey: number,
  portfolios: readonly T[],
  filter: MemberFilter | undefined,
): Promise<T[]> {
  if (!filter) return [...portfolios];
  const active = new Set((await loadActiveMembers(em, tenantKey)).keys());
  return portfolios.filter((portfolio) => matchesMemberFilter(accountAttributionOf({ isJoint: false, ownerAppuserKey: portfolio.portfolioOwnerAppuserKey.appuserKey }, active), filter));
}

/** The household's active members, each with the name the clients show for them. */
export function displayNameOf(appuser: { emailAddress: string; firstName?: null | string }): string {
  return appuser.firstName?.trim() || appuser.emailAddress;
}

export async function loadActiveMembers(em: EntityManager, tenantKey: number): Promise<Map<number, string>> {
  const memberships = await em.find(
    AppuserTenant,
    { deletedAt: null, recordActive: true, tenantKey: { tenantKey } },
    { filters: false, orderBy: { appuserTenantKey: 'ASC' }, populate: ['appuserKey'] },
  );
  return new Map(memberships.map((membership) => [membership.appuserKey.appuserKey, displayNameOf(membership.appuserKey)]));
}

/** The attribution a client shows: the member's key and name, both null for Shared. */
export interface AttributionDto {
  appuserKey: null | number;
  displayName: null | string;
}

/** A transaction's, plus whether the transaction sets it itself ("Spent by") or follows its account. */
export interface TransactionAttributionDto extends AttributionDto {
  overridden: boolean;
}

type AppuserRef = null | undefined | { appuserKey: number };

export function attributionDto(attribution: Attribution, members: ReadonlyMap<number, string>): AttributionDto {
  return { appuserKey: attribution, displayName: attribution === null ? null : (members.get(attribution) ?? null) };
}

/** An account entity's attribution as a client shows it. */
export function accountAttributionDto(account: { accountOwnerAppuserKey?: AppuserRef; isJoint: boolean }, members: ReadonlyMap<number, string>): AttributionDto {
  return attributionDto(accountAttributionOf({ isJoint: account.isJoint, ownerAppuserKey: account.accountOwnerAppuserKey?.appuserKey }, new Set(members.keys())), members);
}

/** A transaction entity's attribution as a client shows it; its account is read for the default. */
export function transactionAttributionDto(
  transaction: { accountKey?: null | { accountOwnerAppuserKey?: AppuserRef; isJoint: boolean }; attributedAppuserKey?: AppuserRef; attributedToShared: boolean },
  members: ReadonlyMap<number, string>,
): TransactionAttributionDto {
  const account = { isJoint: transaction.accountKey?.isJoint ?? false, ownerAppuserKey: transaction.accountKey?.accountOwnerAppuserKey?.appuserKey };
  const own = { attributedAppuserKey: transaction.attributedAppuserKey?.appuserKey, attributedToShared: transaction.attributedToShared };
  return {
    ...attributionDto(transactionAttributionOf(own, account, new Set(members.keys())), members),
    overridden: own.attributedAppuserKey != null || own.attributedToShared,
  };
}

/**
 * What a "Spent by" change asks for: a member's key, `shared`, or null to follow the account again.
 * A member must be an active member of the transaction's household; anyone else is a 400, whether
 * they exist elsewhere or not.
 */
export async function resolveAttributionChange(
  em: EntityManager,
  tenantKey: number,
  value: null | number | typeof SHARED_MEMBER,
): Promise<{ attributedAppuserKey: null | number; attributedToShared: boolean }> {
  if (value === null) return { attributedAppuserKey: null, attributedToShared: false };
  if (value === SHARED_MEMBER) return { attributedAppuserKey: null, attributedToShared: true };
  const members = await loadActiveMembers(em, tenantKey);
  if (!members.has(value)) throw new BadRequestError('A transaction can be attributed only to a member of its household');
  return { attributedAppuserKey: value, attributedToShared: false };
}
