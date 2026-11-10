import { raw } from '@mikro-orm/core';
import { type Expression, sql, type SqlBool } from 'kysely';

import { hasSpendingLineSql } from './category-lines';
import { type TransactionDateRange, transactionDateRangeSql } from './transaction-date-range';
import { notExpiredTransactionSql } from './transaction-status';

/**
 * "The transactions in this period": which stored transactions a total, a report or the
 * transaction list counts, decided in one place.
 *
 * Every surface that totals or lists transactions builds its row condition from a
 * {@link TransactionScope}: the reports (`report-filters.ts`), the transaction list and its total
 * (`transaction-total.service.ts`), the dashboard's cash flow and category spending, and budget
 * spending. Each states its options in one visible place, and the same options give the same rows
 * whatever runs the query: {@link transactionScopeWhere} for MikroORM, {@link transactionScopeSql}
 * for hand-written SQL and {@link transactionScopeExpression} for Kysely all render one SQL text.
 * So a report total and the list a report links to (`listFiltersForReport`) can only disagree by
 * the arithmetic, which `transaction-totals.ts` shares too.
 *
 * Always applied, whatever the options:
 *
 * - **Tenant.** The row and its account belong to the household. Raw SQL and Kysely bypass
 *   MikroORM's tenant filter, so the condition is explicit here, never left to the filter.
 * - **Privacy.** A private account's rows are its owner's only (`Account.isPrivate`).
 * - **Deleted.** A deleted row never counts, and neither does a row on a deleted account (deleting
 *   an account leaves its rows in place). A row with no account is not a bank or cash movement and
 *   is never counted either.
 *
 * Options, each a rule some surface sets differently:
 *
 * - `statuses`: the status names that count, or `'not-expired'` for every row but an EXPIRED one
 *   (a legacy row with no status included; `transaction-status.ts`).
 * - `includeTransfers`: a transfer between own accounts (matched, or marked by the user) is
 *   neither income nor spending.
 * - `includeHidden`: a row a member hid.
 * - `includeNonSpending`: false leaves out a row none of whose category lines counts as spending
 *   (`category-spending.ts`). A split row with some spending lines stays; a total then adds only
 *   those lines (`transaction-totals.ts`, `spendingLinesOf`).
 */
export type TransactionStatusName = 'BOOKED' | 'PENDING';

const STATUS_NAMES: readonly TransactionStatusName[] = ['BOOKED', 'PENDING'];

export interface TransactionScope {
  /** Only these accounts (empty or absent: every account the viewer may see). */
  accountKeys?: readonly number[];
  /** The range on the viewer's calendar (`transaction-date-range.ts`). */
  dateRange?: TransactionDateRange;
  /** Money in (positive) or money out (negative) only; a row with no converted amount by the sign of its own amount. */
  direction?: 'in' | 'out';
  includeHidden: boolean;
  includeNonSpending: boolean;
  includeTransfers: boolean;
  /** Only rows stored in this member currency (`appuserCurrencyKey`, by code). */
  memberCurrencyCode?: string;
  /** Only rows with one of these merchants. */
  merchantKeys?: readonly number[];
  /** Only accounts that are not closed. */
  openAccountsOnly?: boolean;
  statuses: 'not-expired' | readonly TransactionStatusName[];
  tenantKey: number;
  /** The member looking: private accounts are visible to their owner only. */
  viewerAppuserKey: number;
}

/**
 * Transaction types that move money between the household's own accounts (a matched pair, or a row
 * a user marked as a transfer). Never income or spending.
 */
export const TRANSFER_TYPE_NAMES = ['TRANSFER_IN', 'TRANSFER_OUT'] as const;

/**
 * SQL: the row aliased `alias` (unquoted) is not a transfer. A row with no type is not one. `alias`
 * is a table alias written by the caller, never input.
 */
export function notTransferSql(alias: string): string {
  return `not exists (select 1 from "transaction_type" transfer_type where transfer_type."transaction_type_key" = "${alias}"."transaction_type_key" and transfer_type."name" in (${TRANSFER_TYPE_NAMES.map((name) => `'${name}'`).join(', ')}))`;
}

/**
 * SQL: the row is money out. Read by the sign of its amount in the user's currency, or when it has
 * none (`fxStatus` `missing`) by the sign of its own amount, as `isMoneyOut` in `report-currency.ts`.
 */
export function moneyOutSql(alias: string): string {
  return `(case when "${alias}"."appuser_settlement_amount" is not null then "${alias}"."appuser_settlement_amount" < 0 else coalesce("${alias}"."edited_settlement_amount", "${alias}"."settlement_amount", 0) < 0 end)`;
}

/** SQL: the row is money in, the counterpart of {@link moneyOutSql}. A zero amount is neither. */
export function moneyInSql(alias: string): string {
  return `(case when "${alias}"."appuser_settlement_amount" is not null then "${alias}"."appuser_settlement_amount" > 0 else coalesce("${alias}"."edited_settlement_amount", "${alias}"."settlement_amount", 0) > 0 end)`;
}

/** A condition as SQL with `?` placeholders and their values, in order. */
export interface SqlCondition {
  params: unknown[];
  sql: string;
}

function integer(value: number, name: string): string {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`);
  return String(value);
}

function integerList(values: readonly number[], name: string): string {
  return `array[${values.map((value) => integer(value, name)).join(', ')}]::int[]`;
}

/**
 * The scope's condition on the transaction aliased `alias`. Keys are inlined (validated as
 * integers) and status names come from a fixed list, so the only values are dates and a currency
 * code. The SQL itself contains no `?` but the placeholders.
 */
export function transactionScopeSql(alias: string, scope: TransactionScope): SqlCondition {
  if (!/^[a-z_]\w*$/i.test(alias)) throw new TypeError(`Not a table alias: ${alias}`);
  const tenantKey = integer(scope.tenantKey, 'tenantKey');
  const viewer = integer(scope.viewerAppuserKey, 'viewerAppuserKey');
  const row = `"${alias}"`;
  const params: unknown[] = [];

  const account = [
    `scope_account."account_key" = ${row}."account_key"`,
    `scope_account."tenant_key" = ${tenantKey}`,
    'scope_account."deleted_at" is null',
    `(scope_account."is_private" = false or scope_account."account_owner_appuser_key" = ${viewer})`,
    ...(scope.openAccountsOnly ? ['scope_account."closed" = false'] : []),
    ...(scope.accountKeys && scope.accountKeys.length > 0 ? [`scope_account."account_key" = any(${integerList(scope.accountKeys, 'accountKeys')})`] : []),
  ];
  const conditions = [
    `${row}."tenant_key" = ${tenantKey}`,
    `${row}."deleted_at" is null`,
    `exists (select 1 from "account" scope_account where ${account.join(' and ')})`,
  ];

  if (scope.statuses === 'not-expired') conditions.push(notExpiredTransactionSql(alias));
  else {
    const names = [...new Set(scope.statuses)];
    if (names.length === 0 || names.some((name) => !STATUS_NAMES.includes(name))) throw new TypeError(`Not a list of statuses: ${names.join(', ')}`);
    conditions.push(`exists (select 1 from "transaction_status" scope_status where scope_status."transaction_status_key" = ${row}."transaction_status_key" and scope_status."name" in (${names.map((name) => `'${name}'`).join(', ')}))`);
  }
  if (!scope.includeHidden) conditions.push(`${row}."hidden" = false`);
  if (!scope.includeTransfers) conditions.push(notTransferSql(alias));
  if (!scope.includeNonSpending) conditions.push(hasSpendingLineSql(alias, scope.tenantKey));
  if (scope.direction === 'out') conditions.push(moneyOutSql(alias));
  if (scope.direction === 'in') conditions.push(moneyInSql(alias));
  if (scope.merchantKeys && scope.merchantKeys.length > 0) conditions.push(`${row}."transaction_merchant_key" = any(${integerList(scope.merchantKeys, 'merchantKeys')})`);
  if (scope.memberCurrencyCode !== undefined) {
    conditions.push(`exists (select 1 from "currency" scope_currency where scope_currency."currency_key" = ${row}."appuser_currency_key" and scope_currency."code" = ?)`);
    params.push(scope.memberCurrencyCode);
  }
  const inRange = scope.dateRange ? transactionDateRangeSql(`${row}."transaction_date"`, scope.dateRange) : null;
  if (inRange) {
    conditions.push(inRange.sql);
    params.push(...inRange.params);
  }

  return { params, sql: `(${conditions.join(' and ')})` };
}

/**
 * The scope as a MikroORM `where` entry on the `Transaction` root, to spread into a filter. A fresh
 * raw fragment per call, as MikroORM requires.
 */
export function transactionScopeWhere(scope: TransactionScope): Record<string, unknown> {
  const placeholder = 'scope_root';
  const condition = transactionScopeSql(placeholder, scope);
  return { [raw((alias: string) => condition.sql.replaceAll(`"${placeholder}"`, `"${alias}"`), condition.params)]: true };
}

/** The scope as a Kysely expression on the transaction aliased `alias`. */
export function transactionScopeExpression(alias: string, scope: TransactionScope): Expression<SqlBool> {
  const condition = transactionScopeSql(alias, scope);
  const [first = '', ...rest] = condition.sql.split('?');
  return sql<SqlBool>`${sql.join([sql.raw(first), ...rest.flatMap((part, index) => [sql`${condition.params[index]}`, sql.raw(part)])], sql.raw(''))}`;
}

/**
 * The dashboard's month figures, cash flow and category spending: pending rows count (EXPIRED rows
 * never moved money), no hidden row, no transfer between own accounts, and only category lines in
 * categories that count as spending. The transaction list shows the same rows with
 * `excludeTransfers` and `excludeNonSpending`.
 */
export function dashboardScope(input: Pick<TransactionScope, 'dateRange' | 'tenantKey' | 'viewerAppuserKey'>): TransactionScope {
  return { ...input, includeHidden: false, includeNonSpending: false, includeTransfers: false, statuses: 'not-expired' };
}
