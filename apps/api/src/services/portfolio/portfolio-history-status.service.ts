import { addDays, subYears } from 'date-fns';
import { sql } from 'kysely';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { sqlQuery, toDate } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import { NotFoundError } from '@utils/errors';

export type PortfolioHistoryStatus = 'partial' | 'processing' | 'ready' | 'unavailable';

export interface PortfolioHistoryStatusResponse {
  assetsPending: number;
  assetsReady: number;
  assetsTotal: number;
  earliestRequiredDate: Date | null;
  earliestSnapshotDate: Date | null;
  latestSnapshotDate: Date | null;
  status: PortfolioHistoryStatus;
}

interface BuyRangeRow { earliest_buy_date: Date | string; financial_asset_key: number; latest_created_at: Date | string; }
interface PriceRow { date: Date | string; financial_asset_key: number; }
interface SnapshotRangeRow { earliest_snapshot_date: Date | null | string; latest_snapshot_date: Date | null | string; }

const EDGE_TOLERANCE_DAYS = 1;
const MIN_COVERAGE_RATIO = 0.95;
const PROCESSING_STALE_DAYS = 3;

class PortfolioHistoryStatusService {
  async getPortfolioHistoryStatus(appuser: Appuser, portfolioId: number, tenantKey?: number): Promise<PortfolioHistoryStatusResponse> {
    const portfolio = await DI.em.findOne(Portfolio, {
      deletedAt: undefined,
      portfolioKey: portfolioId,
    });

    if (!portfolio) throw new NotFoundError('Portfolio not found');

    const db = sqlQuery(DI.em);
    const buyRows = (await db
      .selectFrom('financial_transaction as ft')
      .select([
        'ft.financial_asset_key',
        sql<Date | string>`MIN(ft.transaction_date)`.as('earliest_buy_date'),
        sql<Date | string>`MAX(ft.created_at)`.as('latest_created_at'),
      ])
      .where((eb) => (tenantKey == null ? eb('ft.appuser_key', '=', appuser.appuserKey) : eb('ft.tenant_key', '=', tenantKey)))
      .where('ft.portfolio_key', '=', portfolioId)
      .where('ft.deleted_at', 'is', null)
      .where('ft.financial_transaction_type_key', '=', FINANCIAL_TRANSACTION_TYPES.BUY)
      .groupBy('ft.financial_asset_key')
      .execute()) as BuyRangeRow[];

    const assetsTotal = buyRows.length;
    const today = startOfUTCDay(new Date());
    const tenYearsAgo = startOfUTCDay(subYears(today, 10));

    const latestExpectedDate = getPreviousBusinessDayOnOrBefore(today);
    const earliestRequiredDate = buyRows.reduce<Date | null>((min, row) => {
      const earliestBuyDate = normalizeDate(row.earliest_buy_date);
      const requiredFrom = earliestBuyDate > tenYearsAgo ? startOfUTCDay(earliestBuyDate) : tenYearsAgo;
      return !min || requiredFrom < min ? requiredFrom : min;
    }, null);

    let assetsReady = 0;
    let latestPendingCreatedAt: Date | null = null;
    for (const row of buyRows) {
      const earliestBuyDate = normalizeDate(row.earliest_buy_date);
      const requiredFrom = getNextBusinessDayOnOrAfter(earliestBuyDate > tenYearsAgo ? startOfUTCDay(earliestBuyDate) : tenYearsAgo);
      const prices = (await db
        .selectFrom('financial_asset_price')
        .select(['financial_asset_key', 'date'])
        .where('financial_asset_key', '=', row.financial_asset_key)
        .where('date', '>=', requiredFrom)
        .where('date', '<=', latestExpectedDate)
        .orderBy('date', 'asc')
        .execute()) as PriceRow[];
      if (isPriceCoverageSufficient(requiredFrom, latestExpectedDate, prices.map((price) => normalizeDate(price.date)))) {
        assetsReady += 1;
      } else {
        const createdAt = normalizeDate(row.latest_created_at);
        if (!latestPendingCreatedAt || createdAt > latestPendingCreatedAt) {
          latestPendingCreatedAt = createdAt;
        }
      }
    }

    const snapshots = (await db
      .selectFrom('portfolio_snapshot')
      .select([
        sql<Date | null | string>`MIN(snapshot_date)`.as('earliest_snapshot_date'),
        sql<Date | null | string>`MAX(snapshot_date)`.as('latest_snapshot_date'),
      ])
      .where('portfolio_key', '=', portfolioId)
      .execute()) as SnapshotRangeRow[];

    const earliestSnapshotDate = normalizeNullableDate(snapshots[0]?.earliest_snapshot_date ?? null);
    const latestSnapshotDate = normalizeNullableDate(snapshots[0]?.latest_snapshot_date ?? null);
    const assetsPending = assetsTotal - assetsReady;
    const priceCoverageComplete = assetsPending === 0;
    const snapshotCoverageComplete =
      !assetsTotal ||
      (earliestRequiredDate !== null &&
        earliestSnapshotDate !== null &&
        latestSnapshotDate !== null &&
        isSnapshotRangeCovered(earliestSnapshotDate, latestSnapshotDate, earliestRequiredDate, latestExpectedDate));

    const isStuck = !priceCoverageComplete
      && latestPendingCreatedAt !== null
      && dayDiff(latestPendingCreatedAt, today) > PROCESSING_STALE_DAYS;

    const status: PortfolioHistoryStatus = assetsTotal === 0
      ? 'ready'
      : isStuck
        ? 'unavailable'
        : !priceCoverageComplete
          ? 'processing'
          : snapshotCoverageComplete
            ? 'ready'
            : 'partial';

    return {
      assetsPending,
      assetsReady,
      assetsTotal,
      earliestRequiredDate,
      earliestSnapshotDate,
      latestSnapshotDate,
      status,
    };
  }
}

function countBusinessDaysInclusive(from: Date, to: Date): number {
  let count = 0;
  for (let cursor = startOfUTCDay(from); cursor <= startOfUTCDay(to); cursor = addDays(cursor, 1)) {
    if (!isWeekendUTC(cursor)) count += 1;
  }
  return count;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfUTCDay(b).getTime() - startOfUTCDay(a).getTime()) / (24 * 60 * 60 * 1000));
}

function getNextBusinessDayOnOrAfter(date: Date): Date {
  let cursor = startOfUTCDay(date);
  while (isWeekendUTC(cursor)) cursor = startOfUTCDay(addDays(cursor, 1));
  return cursor;
}

function getPreviousBusinessDayOnOrBefore(date: Date): Date {
  let cursor = startOfUTCDay(date);
  while (isWeekendUTC(cursor)) cursor = startOfUTCDay(addDays(cursor, -1));
  return cursor;
}

function isPriceCoverageSufficient(requiredFrom: Date, latestDate: Date, prices: Date[]): boolean {
  const sorted = [...prices].sort((a, b) => a.getTime() - b.getTime());
  if (!sorted.length) return false;

  const expectedStart = getNextBusinessDayOnOrAfter(requiredFrom);
  const expectedEnd = getPreviousBusinessDayOnOrBefore(latestDate);
  if (expectedStart > expectedEnd) return false;

  const coveredDays = new Set(sorted.map((price) => startOfUTCDay(price).toISOString()));
  const firstPrice = sorted[0];
  const lastPrice = sorted[sorted.length - 1];
  if (!firstPrice || !lastPrice) return false;
  const firstOffset = dayDiff(expectedStart, firstPrice);
  const lastOffset = dayDiff(lastPrice, expectedEnd);
  const expectedBusinessDays = countBusinessDaysInclusive(expectedStart, expectedEnd);

  return firstOffset >= 0 && firstOffset <= EDGE_TOLERANCE_DAYS && lastOffset >= 0 && lastOffset <= EDGE_TOLERANCE_DAYS && coveredDays.size / expectedBusinessDays >= MIN_COVERAGE_RATIO;
}

function isSnapshotRangeCovered(earliestActual: Date, latestActual: Date, earliestExpected: Date, latestExpected: Date): boolean {
  return dayDiff(earliestExpected, earliestActual) <= EDGE_TOLERANCE_DAYS && dayDiff(latestActual, latestExpected) <= EDGE_TOLERANCE_DAYS;
}

function isWeekendUTC(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function normalizeDate(value: Date | string): Date {
  return toDate(value);
}

function normalizeNullableDate(value: Date | null | string): Date | null {
  return value === null ? null : normalizeDate(value);
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default new PortfolioHistoryStatusService();
