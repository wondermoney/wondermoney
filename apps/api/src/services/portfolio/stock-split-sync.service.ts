import { type RequiredEntityData, UniqueConstraintViolationException } from '@mikro-orm/core';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { sqlQuery } from '@app/database/sql';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES } from '@entity/FinancialAssetStockAdjustment';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import eodhd from '@service/market-data/eodhd.service';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

import portfolioSnapshotService from './portfolio-snapshot.service';

/** A normalized split row this service works with, independent of EODHD's raw string ratio format. */
export interface NormalizedSplitRow {
  date: string;
  denominator: number;
  label: string;
  numerator: number;
}

interface StockSplitAdjustmentLike {
  date: Date;
  deletedAt?: Date | null;
  denominator?: null | number;
  financialAssetKey: FinancialAsset;
  name: string;
  numerator?: null | number;
  splitRatio?: null | number;
}

const SPLIT_RATIO_TOLERANCE = 1e-9;

export async function syncStockSplitsForAsset(financialAsset: FinancialAsset): Promise<{ inserted: number }> {
  return syncStockSplits(financialAsset);
}

export async function syncStockSplitsForSymbol(symbol: string): Promise<{ inserted: number }> {
  const financialAsset = await DI.em.findOne(FinancialAsset, { symbol });
  if (!financialAsset) {
    throw new Error(`Financial asset not found for symbol ${symbol}`);
  }

  return syncStockSplits(financialAsset);
}

async function fetchSplitRows(symbol: string): Promise<NormalizedSplitRow[]> {
  const rows = await eodhd.getSplits(symbol);
  return rows
    .map((row) => {
      const ratio = parseSplitRatio(row.split);
      if (!ratio) return null;
      return { date: row.date, denominator: ratio.denominator, label: row.split, numerator: ratio.numerator };
    })
    .filter((row): row is NormalizedSplitRow => row !== null);
}

async function findExistingSplitAdjustment(em: typeof DI.em, financialAssetKey: number, date: Date, numerator: number, denominator: number, name: string): Promise<FinancialAssetStockAdjustment | null> {
  const assetRef = getRef(em, FinancialAsset, financialAssetKey);
  const candidates = await em.find(FinancialAssetStockAdjustment, {
    adjustmentType: FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES.SPLIT,
    financialAssetKey: assetRef,
  });

  const naturalMatch = candidates.find((candidate) => sameCalendarDay(candidate.date, date) && candidate.numerator === numerator && candidate.denominator === denominator);
  if (naturalMatch) return naturalMatch;

  const ratioMatch = candidates.find((candidate) => sameCalendarDay(candidate.date, date) && hasMatchingSplitRatio(candidate as null | StockSplitAdjustmentLike, numerator / denominator));
  if (ratioMatch) return ratioMatch;

  return candidates.find((candidate) => candidate.name === name) ?? null;
}

function hasMatchingSplitRatio(existing: null | StockSplitAdjustmentLike, ratio: number): boolean {
  return existing?.splitRatio != null && Math.abs(existing.splitRatio - ratio) <= SPLIT_RATIO_TOLERANCE;
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}

function normalizeCalendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseSplitRatio(split: string): null | { denominator: number; numerator: number } {
  // EODHD encodes splits as "numerator/denominator", e.g. "4/1" for a 4-for-1 split.
  const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(split.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null;
  return { denominator, numerator };
}

async function refreshAffectedPortfolioSnapshots(assetKey: number, earliestInsertedSplitDate: Date, em: typeof DI.em): Promise<void> {
  try {
    const affectedRows = (await sqlQuery(em)
      .selectFrom('financial_transaction')
      .innerJoin('portfolio', 'portfolio.portfolio_key', 'financial_transaction.portfolio_key')
      .select((eb) => ['financial_transaction.portfolio_key', eb.fn.min('financial_transaction.transaction_date').as('earliest_transaction_date')])
      .where('financial_transaction.financial_asset_key', '=', assetKey)
      .where('financial_transaction.financial_transaction_type_key', 'in', [FINANCIAL_TRANSACTION_TYPES.BUY, FINANCIAL_TRANSACTION_TYPES.SELL])
      .where('financial_transaction.portfolio_key', 'is not', null)
      .where('financial_transaction.transaction_date', 'is not', null)
      .where('financial_transaction.deleted_at', 'is', null)
      .where('portfolio.deleted_at', 'is', null)
      .groupBy('financial_transaction.portfolio_key')
      .execute()) as { earliest_transaction_date: Date | string; portfolio_key: number }[];

    for (const row of affectedRows) {
      const replayFromDate = minDate(parseDate(row.earliest_transaction_date), earliestInsertedSplitDate);
      try {
        await portfolioSnapshotService.backfillSnapshotsForPortfolio(row.portfolio_key, replayFromDate);
      } catch (error) {
        logger.warn({ assetKey, error, portfolioKey: row.portfolio_key, replayFromDate }, 'Failed to refresh portfolio snapshots after stock split sync');
      }
    }
  } catch (error) {
    logger.warn({ assetKey, error }, 'Failed to discover affected portfolios for stock split snapshot refresh');
  }
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

async function syncStockSplits(financialAsset: FinancialAsset): Promise<{ inserted: number }> {
  const em = DI.em.fork();
  const assetKey = financialAsset.financialAssetKey;
  const assetSymbol = financialAsset.symbol;
  const rows = await fetchSplitRows(assetSymbol);
  let inserted = 0;
  let earliestInsertedSplitDate: Date | null = null;

  for (const row of rows) {
    // numerator/denominator are already validated finite positive numbers by fetchSplitRows
    const { denominator, numerator } = row;

    const date = normalizeCalendarDay(new Date(row.date));
    if (Number.isNaN(date.getTime())) continue;
    if (date.getTime() > normalizeCalendarDay(new Date()).getTime()) continue;

    const name = `${assetSymbol}-${date.toISOString().slice(0, 10)}-${numerator}:${denominator}`;
    const existing = await findExistingSplitAdjustment(em, assetKey, date, numerator, denominator, name);
    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = undefined;
        existing.date = date;
        existing.denominator = denominator;
        existing.financialAssetKey = getRef(em, FinancialAsset, assetKey);
        existing.name = name;
        existing.numerator = numerator;
        existing.source = 'EODHD';
        existing.sourceLabel = row.label;
        existing.splitRatio = numerator / denominator;
        await em.flush();
        inserted += 1;
        if (!earliestInsertedSplitDate || date < earliestInsertedSplitDate) earliestInsertedSplitDate = date;
      }
      continue;
    }

    try {
      const assetRef = getRef(em, FinancialAsset, assetKey);
      em.create(FinancialAssetStockAdjustment, {
        adjustmentType: FINANCIAL_ASSET_STOCK_ADJUSTMENT_TYPES.SPLIT,
        date,
        denominator,
        financialAssetKey: assetRef,
        name,
        numerator,
        source: 'EODHD',
        sourceLabel: row.label,
        splitRatio: numerator / denominator,
      } as RequiredEntityData<FinancialAssetStockAdjustment>);
      await em.flush();
      inserted += 1;
      if (!earliestInsertedSplitDate || date < earliestInsertedSplitDate) earliestInsertedSplitDate = date;
    } catch (err) {
      if (!(err instanceof UniqueConstraintViolationException)) throw err;
      em.clear();
      const recovered = await findExistingSplitAdjustment(em, assetKey, date, numerator, denominator, name);
      if (!recovered) throw err;
    }
  }

  if (inserted > 0 && earliestInsertedSplitDate) {
    await refreshAffectedPortfolioSnapshots(assetKey, earliestInsertedSplitDate, em);
  }

  return { inserted };
}

