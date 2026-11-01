import { differenceInDays, startOfMonth } from 'date-fns';
import type { Request, Response } from 'express';
import { sql } from 'kysely';

import { sqlQuery } from '@app/database/sql';
import { authedContext } from '@middleware/authed-context';
import { notExpiredTransactionSql } from '@service/transaction/transaction-status';
import { buildEffectiveAmountSql } from '@utils/account-amounts';
import {
  getAccountMetricsRequestSchema,
  getAccountsMetricsRequestSchema,
} from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

interface AccountMetrics {
  accountKey: number;
  accountName: string;
  currencyCode: string;
  inflowCurrentPeriod: number;
  inflowDelta: number;
  inflowDeltaPercentage: number;
  inflowPastPeriod: number;
  outflowCurrentPeriod: number;
  outflowDelta: number;
  outflowDeltaPercentage: number;
  outflowPastPeriod: number;
  transactionCountCurrentPeriod: number;
  transactionCountDelta: number;
  transactionCountDeltaPercentage: number;
  transactionCountPastPeriod: number;
  transactionType: string;
  type: 'inflow' | 'outflow';
}

export async function getAccountMetrics(req: Request, res: Response) {
  const {
    params: { accountId },
    query: { fromDate },
  } = await zParse(getAccountMetricsRequestSchema, req);

  const { appuserKey, tenantKey } = authedContext(req);
  const effectiveAmount = sql.raw(buildEffectiveAmountSql('t'));

  // Calculate periods
  const currentPeriodEnd = new Date();
  const currentPeriodStart = fromDate ?? startOfMonth(currentPeriodEnd);
  const periodDays = differenceInDays(currentPeriodEnd, currentPeriodStart);
  const pastPeriodEnd = new Date(currentPeriodStart);
  pastPeriodEnd.setDate(pastPeriodEnd.getDate() - 1);
  const pastPeriodStart = new Date(pastPeriodEnd);
  pastPeriodStart.setDate(pastPeriodStart.getDate() - periodDays);

  const metrics = (await sqlQuery(DI.em)
    .with('c', (db) =>
      db
        .selectFrom('account as a')
        .leftJoin('transaction as t', (join) =>
          join
            .onRef('t.account_key', '=', 'a.account_key')
            .on(sql<boolean>`t.hidden = false`)
            // Raw SQL bypasses the ORM soft-delete filter — without this a
            // deleted transaction would inflate inflow/outflow and the transaction count.
            .on('t.deleted_at', 'is', null)
            // An EXPIRED row never moved money. In the join, so an account still appears.
            .on(sql.raw<boolean>(notExpiredTransactionSql('t'))))
        .innerJoin('currency as c', 'a.currency_key', 'c.currency_key')
        .select([
          'a.account_key as accountKey',
          'a.account_name as accountName',
          'c.code as currencyCode',
          // For accounts without transactions, we'll set type to 'inflow' by default
          sql<string>`'inflow'`.as('type'),
          // Current period inflow
          sql<number>`COALESCE(SUM(CASE WHEN ${effectiveAmount} > 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0)`.as('inflowCurrentPeriod'),
          // Current period outflow
          sql<number>`ABS(COALESCE(SUM(CASE WHEN ${effectiveAmount} < 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0))`.as('outflowCurrentPeriod'),
          // Current period transaction count
          sql<number>`CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0) AS INTEGER)`.as('transactionCountCurrentPeriod'),
          // Past period inflow
          sql<number>`COALESCE(SUM(CASE WHEN ${effectiveAmount} > 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0)`.as('inflowPastPeriod'),
          // Past period outflow
          sql<number>`ABS(COALESCE(SUM(CASE WHEN ${effectiveAmount} < 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0))`.as('outflowPastPeriod'),
          // Past period transaction count
          sql<number>`CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0) AS INTEGER)`.as('transactionCountPastPeriod'),
        ])
        // Household-scoped (raw SQL bypasses the tenant filter) + per-account
        // privacy carve-out — a private account's metrics are visible only to its owner.
        .where('a.tenant_key', '=', tenantKey)
        .where('a.deleted_at', 'is', null)
        .where('a.account_key', '=', accountId)
        .where((eb) => eb.or([eb('a.is_private', '=', false), eb('a.account_owner_appuser_key', '=', appuserKey)]))
        .groupBy(sql`a.account_key, a.account_name, c.code`),
    )
    .selectFrom('c')
    .selectAll('c')
    .select([
      sql<number>`c."inflowCurrentPeriod" - c."inflowPastPeriod"`.as('inflowDelta'),
      sql<number>`(CASE WHEN c."inflowPastPeriod" = 0 THEN c."inflowCurrentPeriod" ELSE ROUND(100 * (c."inflowCurrentPeriod" - c."inflowPastPeriod")::numeric / c."inflowPastPeriod", 2) END)`.as('inflowDeltaPercentage'),
      sql<number>`c."outflowCurrentPeriod" - c."outflowPastPeriod"`.as('outflowDelta'),
      sql<number>`(CASE WHEN c."outflowPastPeriod" = 0 THEN c."outflowCurrentPeriod" ELSE ROUND(100 * (c."outflowCurrentPeriod" - c."outflowPastPeriod")::numeric / c."outflowPastPeriod", 2) END)`.as('outflowDeltaPercentage'),
      sql<number>`c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod"`.as('transactionCountDelta'),
      sql<number>`ROUND(100 * (c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod")::numeric / (CASE WHEN c."transactionCountPastPeriod" <> 0 THEN c."transactionCountPastPeriod" ELSE 1 END), 2)`.as('transactionCountDeltaPercentage'),
    ])
    .execute()) as AccountMetrics[];

  return res.json({ metrics });
}

export async function getAccountsMetrics(req: Request, res: Response) {
  const {
    query: { fromDate, toDate },
  } = await zParse(getAccountsMetricsRequestSchema, req);

  const { appuserKey, tenantKey } = authedContext(req);
  const effectiveAmount = sql.raw(buildEffectiveAmountSql('t'));

  // Calculate periods
  const currentPeriodEnd = toDate ?? new Date();
  const currentPeriodStart = fromDate ?? startOfMonth(currentPeriodEnd);
  const periodDays = differenceInDays(currentPeriodEnd, currentPeriodStart);
  const pastPeriodEnd = new Date(currentPeriodStart);
  pastPeriodEnd.setDate(pastPeriodEnd.getDate() - 1);
  const pastPeriodStart = new Date(pastPeriodEnd);
  pastPeriodStart.setDate(pastPeriodStart.getDate() - periodDays);

  const metrics = (await sqlQuery(DI.em)
    .with('c', (db) =>
      db
        .selectFrom('account as a')
        .leftJoin('transaction as t', (join) =>
          join
            .onRef('t.account_key', '=', 'a.account_key')
            .on(sql<boolean>`t.hidden = false`)
            // Raw SQL bypasses the ORM soft-delete filter — without this a
            // deleted transaction would inflate inflow/outflow and the transaction count.
            .on('t.deleted_at', 'is', null)
            // An EXPIRED row never moved money. In the join, so an account still appears.
            .on(sql.raw<boolean>(notExpiredTransactionSql('t'))))
        .innerJoin('currency as c', 'a.currency_key', 'c.currency_key')
        .select([
          'a.account_key as accountKey',
          'a.account_name as accountName',
          'c.code as currencyCode',
          // For accounts without transactions, we'll set type to 'inflow' by default
          sql<string>`'inflow'`.as('type'),
          // Current period inflow
          sql<number>`COALESCE(SUM(CASE WHEN ${effectiveAmount} > 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0)`.as('inflowCurrentPeriod'),
          // Current period outflow
          sql<number>`ABS(COALESCE(SUM(CASE WHEN ${effectiveAmount} < 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0))`.as('outflowCurrentPeriod'),
          // Current period transaction count
          sql<number>`CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ${currentPeriodStart} AND ${currentPeriodEnd}), 0) AS INTEGER)`.as('transactionCountCurrentPeriod'),
          // Past period inflow
          sql<number>`COALESCE(SUM(CASE WHEN ${effectiveAmount} > 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0)`.as('inflowPastPeriod'),
          // Past period outflow
          sql<number>`ABS(COALESCE(SUM(CASE WHEN ${effectiveAmount} < 0 THEN ${effectiveAmount} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0))`.as('outflowPastPeriod'),
          // Past period transaction count
          sql<number>`CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ${pastPeriodStart} AND ${pastPeriodEnd}), 0) AS INTEGER)`.as('transactionCountPastPeriod'),
        ])
        // Household-scoped (raw SQL bypasses the tenant filter) + per-account
        // privacy carve-out — private accounts are visible only to their owner.
        .where('a.tenant_key', '=', tenantKey)
        .where('a.deleted_at', 'is', null)
        .where((eb) => eb.or([eb('a.is_private', '=', false), eb('a.account_owner_appuser_key', '=', appuserKey)]))
        .groupBy(sql`a.account_key, a.account_name, c.code`),
    )
    .selectFrom('c')
    .selectAll('c')
    .select([
      sql<number>`c."inflowCurrentPeriod" - c."inflowPastPeriod"`.as('inflowDelta'),
      sql<number>`(CASE WHEN c."inflowPastPeriod" = 0 THEN c."inflowCurrentPeriod" ELSE ROUND(100 * (c."inflowCurrentPeriod" - c."inflowPastPeriod")::numeric / c."inflowPastPeriod", 2) END)`.as('inflowDeltaPercentage'),
      sql<number>`c."outflowCurrentPeriod" - c."outflowPastPeriod"`.as('outflowDelta'),
      sql<number>`(CASE WHEN c."outflowPastPeriod" = 0 THEN c."outflowCurrentPeriod" ELSE ROUND(100 * (c."outflowCurrentPeriod" - c."outflowPastPeriod")::numeric / c."outflowPastPeriod", 2) END)`.as('outflowDeltaPercentage'),
      sql<number>`c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod"`.as('transactionCountDelta'),
      sql<number>`ROUND(100 * (c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod")::numeric / (CASE WHEN c."transactionCountPastPeriod" <> 0 THEN c."transactionCountPastPeriod" ELSE 1 END), 2)`.as('transactionCountDeltaPercentage'),
    ])
    .execute()) as AccountMetrics[];

  return res.json({ metrics });
}
