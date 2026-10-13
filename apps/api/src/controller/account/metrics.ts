import { differenceInDays, startOfMonth } from 'date-fns';
import type { Request, Response } from 'express';

import { buildEffectiveAmountSql } from '@utils/account-amounts';
import {
  getAccountMetricsRequestSchema,
  getAccountsMetricsRequestSchema,
} from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

export async function getAccountMetrics(req: Request, res: Response) {
  const {
    params: { accountId },
    query: { fromDate },
  } = await zParse(getAccountMetricsRequestSchema, req);

  const knex = DI.em.getConnection().getKnex();
  const effectiveAmountSql = buildEffectiveAmountSql('t');

  // Calculate periods
  const currentPeriodEnd = new Date();
  const currentPeriodStart = fromDate ?? startOfMonth(currentPeriodEnd);
  const periodDays = differenceInDays(currentPeriodEnd, currentPeriodStart);
  const pastPeriodEnd = new Date(currentPeriodStart);
  pastPeriodEnd.setDate(pastPeriodEnd.getDate() - 1);
  const pastPeriodStart = new Date(pastPeriodEnd);
  pastPeriodStart.setDate(pastPeriodStart.getDate() - periodDays);

  const metrics = (await knex
    .with('c', (qb) =>
      qb
        .select([
          'a.account_key as accountKey',
          'a.account_name as accountName',
          'c.code as currencyCode',
          // For accounts without transactions, we'll set type to 'inflow' by default
          knex.raw('\'inflow\' as "type"'),
          // Current period inflow
          knex.raw(
            `COALESCE(SUM(CASE WHEN ${effectiveAmountSql} > 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) as "inflowCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Current period outflow
          knex.raw(
            `ABS(COALESCE(SUM(CASE WHEN ${effectiveAmountSql} < 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0)) as "outflowCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Current period transaction count
          knex.raw(
            `CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) AS INTEGER) as "transactionCountCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Past period inflow
          knex.raw(
            `COALESCE(SUM(CASE WHEN ${effectiveAmountSql} > 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) as "inflowPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
          // Past period outflow
          knex.raw(
            `ABS(COALESCE(SUM(CASE WHEN ${effectiveAmountSql} < 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0)) as "outflowPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
          // Past period transaction count
          knex.raw(
            `CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) AS INTEGER) as "transactionCountPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
        ])
        .from('account as a')
        .leftJoin('transaction as t', function () {
          this.on('t.account_key', 'a.account_key')
            .andOn(knex.raw('t.hidden = false'))
            // RAD-audit: raw SQL bypasses the ORM soft-delete filter — without this a
            // deleted transaction still inflated inflow/outflow and the transaction count.
            .andOnNull('t.deleted_at');
        })
        .join('currency as c', 'a.currency_key', 'c.currency_key')
        // RAD-343: household-scoped (raw SQL bypasses the tenant filter) + per-account
        // privacy carve-out — a private account's metrics are visible only to its owner.
        .where('a.tenant_key', req.tenant?.tenantKey)
        .andWhere('a.deleted_at', null)
        .andWhere('a.account_key', accountId)
        .andWhere(function () {
          this.where('a.is_private', false).orWhere('a.account_owner_appuser_key', req.user?.appuserKey);
        })
        .groupByRaw('a.account_key, a.account_name, c.code'),
    )
    .select([
      'c.*',
      knex.raw('c."inflowCurrentPeriod" - c."inflowPastPeriod" as "inflowDelta"'),
      knex.raw(
        '(CASE WHEN c."inflowPastPeriod" = 0 THEN c."inflowCurrentPeriod" ELSE ROUND(100 * (c."inflowCurrentPeriod" - c."inflowPastPeriod")::numeric / c."inflowPastPeriod", 2) END) as "inflowDeltaPercentage"',
      ),
      knex.raw('c."outflowCurrentPeriod" - c."outflowPastPeriod" as "outflowDelta"'),
      knex.raw(
        '(CASE WHEN c."outflowPastPeriod" = 0 THEN c."outflowCurrentPeriod" ELSE ROUND(100 * (c."outflowCurrentPeriod" - c."outflowPastPeriod")::numeric / c."outflowPastPeriod", 2) END) as "outflowDeltaPercentage"',
      ),
      knex.raw('c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod" as "transactionCountDelta"'),
      knex.raw(
        'ROUND(100 * (c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod")::numeric / (CASE WHEN c."transactionCountPastPeriod" <> 0 THEN c."transactionCountPastPeriod" ELSE 1 END), 2) as "transactionCountDeltaPercentage"',
      ),
    ])
    .from('c')) as {
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
  }[];

  return res.json({ metrics });
}

export async function getAccountsMetrics(req: Request, res: Response) {
  const {
    query: { fromDate, toDate },
  } = await zParse(getAccountsMetricsRequestSchema, req);

  const knex = DI.em.getConnection().getKnex();
  const effectiveAmountSql = buildEffectiveAmountSql('t');

  // Calculate periods
  const currentPeriodEnd = toDate ?? new Date();
  const currentPeriodStart = fromDate ?? startOfMonth(currentPeriodEnd);
  const periodDays = differenceInDays(currentPeriodEnd, currentPeriodStart);
  const pastPeriodEnd = new Date(currentPeriodStart);
  pastPeriodEnd.setDate(pastPeriodEnd.getDate() - 1);
  const pastPeriodStart = new Date(pastPeriodEnd);
  pastPeriodStart.setDate(pastPeriodStart.getDate() - periodDays);

  const metrics = (await knex
    .with('c', (qb) =>
      qb
        .select([
          'a.account_key as accountKey',
          'a.account_name as accountName',
          'c.code as currencyCode',
          // For accounts without transactions, we'll set type to 'inflow' by default
          knex.raw('\'inflow\' as "type"'),
          // Current period inflow
          knex.raw(
            `COALESCE(SUM(CASE WHEN ${effectiveAmountSql} > 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) as "inflowCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Current period outflow
          knex.raw(
            `ABS(COALESCE(SUM(CASE WHEN ${effectiveAmountSql} < 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0)) as "outflowCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Current period transaction count
          knex.raw(
            `CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) AS INTEGER) as "transactionCountCurrentPeriod"`,
            [currentPeriodStart, currentPeriodEnd],
          ),
          // Past period inflow
          knex.raw(
            `COALESCE(SUM(CASE WHEN ${effectiveAmountSql} > 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) as "inflowPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
          // Past period outflow
          knex.raw(
            `ABS(COALESCE(SUM(CASE WHEN ${effectiveAmountSql} < 0 THEN ${effectiveAmountSql} ELSE 0 END)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0)) as "outflowPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
          // Past period transaction count
          knex.raw(
            `CAST(COALESCE(COUNT(t.transaction_key)
             FILTER (WHERE t.transaction_date BETWEEN ? AND ?), 0) AS INTEGER) as "transactionCountPastPeriod"`,
            [pastPeriodStart, pastPeriodEnd],
          ),
        ])
        .from('account as a')
        .leftJoin('transaction as t', function () {
          this.on('t.account_key', 'a.account_key')
            .andOn(knex.raw('t.hidden = false'))
            // RAD-audit: raw SQL bypasses the ORM soft-delete filter — without this a
            // deleted transaction still inflated inflow/outflow and the transaction count.
            .andOnNull('t.deleted_at');
        })
        .join('currency as c', 'a.currency_key', 'c.currency_key')
        // RAD-343: household-scoped (raw SQL bypasses the tenant filter) + per-account
        // privacy carve-out — private accounts are visible only to their owner.
        .where('a.tenant_key', req.tenant?.tenantKey)
        .andWhere('a.deleted_at', null)
        .andWhere(function () {
          this.where('a.is_private', false).orWhere('a.account_owner_appuser_key', req.user?.appuserKey);
        })
        .groupByRaw('a.account_key, a.account_name, c.code'),
    )
    .select([
      'c.*',
      knex.raw('c."inflowCurrentPeriod" - c."inflowPastPeriod" as "inflowDelta"'),
      knex.raw(
        '(CASE WHEN c."inflowPastPeriod" = 0 THEN c."inflowCurrentPeriod" ELSE ROUND(100 * (c."inflowCurrentPeriod" - c."inflowPastPeriod")::numeric / c."inflowPastPeriod", 2) END) as "inflowDeltaPercentage"',
      ),
      knex.raw('c."outflowCurrentPeriod" - c."outflowPastPeriod" as "outflowDelta"'),
      knex.raw(
        '(CASE WHEN c."outflowPastPeriod" = 0 THEN c."outflowCurrentPeriod" ELSE ROUND(100 * (c."outflowCurrentPeriod" - c."outflowPastPeriod")::numeric / c."outflowPastPeriod", 2) END) as "outflowDeltaPercentage"',
      ),
      knex.raw('c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod" as "transactionCountDelta"'),
      knex.raw(
        'ROUND(100 * (c."transactionCountCurrentPeriod" - c."transactionCountPastPeriod")::numeric / (CASE WHEN c."transactionCountPastPeriod" <> 0 THEN c."transactionCountPastPeriod" ELSE 1 END), 2) as "transactionCountDeltaPercentage"',
      ),
    ])
    .from('c')) as {
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
  }[];

  return res.json({ metrics });
}
