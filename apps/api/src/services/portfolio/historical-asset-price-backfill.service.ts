import { subDays } from 'date-fns';

import { DI } from '@app/database/di';
import { sqlQuery } from '@app/database/sql';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import eodhdClient from '@service/market-data/eodhd.service';

import portfolioSnapshotService from './portfolio-snapshot.service';

export interface HistoricalAssetPriceBackfillResult { failed: number; failures: { reason: string; symbol: string }[]; inserted: number; skipped: number; totalItems: number; }

const toYmd = (date: Date) => date.toISOString().slice(0, 10);
const fromYmd = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isAfterEndDate = (fromDate: Date, endDate: Date) => fromDate > endDate;
const minDate = (current: Date | undefined, next: Date) => (!current || next < current ? next : current);
const dayCount = (fromDate: Date, endDate: Date) => Math.floor((endDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
const rangeCoverage = (fromDate: Date, endDate: Date, existingDates: Set<string>) => {
  const cursor = new Date(fromDate);
  let coverage = 0;
  while (cursor <= endDate) {
    if (!existingDates.has(toYmd(cursor))) return coverage;
    coverage += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return coverage;
};

class HistoricalAssetPriceBackfillService {
  async backfillHistoricalAssetPrices(input: { items: { earliestTransactionDate?: string; financialAssetId?: number; financialAssetKey?: number; symbol: string; transactionDate?: string }[]; portfolioId: number }, deps: { em?: typeof DI.em; eodhd?: typeof eodhdClient; now?: Date; portfolioSnapshotService?: typeof portfolioSnapshotService } = {}): Promise<HistoricalAssetPriceBackfillResult> {
    const em = deps.em ?? DI.em;
    const eodhd = deps.eodhd ?? eodhdClient;
    const snapshotService = deps.portfolioSnapshotService ?? portfolioSnapshotService;
    const today = new Date(deps.now ?? new Date());
    const endDate = subDays(today, 1);
    const endYmd = toYmd(endDate);
    const result: HistoricalAssetPriceBackfillResult = { failed: 0, failures: [], inserted: 0, skipped: 0, totalItems: input.items.length };
    let earliestBackfillDate: Date | undefined;
    let hasSuccessfulBackfillAttempt = false;

    for (const item of input.items) {
      const financialAssetKey = item.financialAssetKey ?? item.financialAssetId;
      const startCandidates = [item.earliestTransactionDate, item.transactionDate].filter((value): value is string => Boolean(value));
      const startYmd = startCandidates.sort()[0];
      if (!financialAssetKey || !startYmd) { result.failed += 1; result.failures.push({ reason: 'missing asset key or transaction date', symbol: item.symbol }); continue; }
      const fromDate = fromYmd(startYmd);
      if (isAfterEndDate(fromDate, endDate)) { result.skipped += 1; continue; }
      try {
        const existing = await em.find(FinancialAssetPrice, { date: { $gte: fromDate, $lte: today }, financialAssetKey: { financialAssetKey } });
        const existingDates = new Set(existing.map((row) => toYmd(row.date)));
        const coveredCount = rangeCoverage(fromDate, endDate, existingDates);
        if (coveredCount === dayCount(fromDate, endDate)) {
          result.skipped += coveredCount;
          hasSuccessfulBackfillAttempt = true;
          earliestBackfillDate = minDate(earliestBackfillDate, fromDate);
          continue;
        }
        const fetched = await eodhd.getEndOfDayPrices(item.symbol, { from: toYmd(fromDate), to: endYmd });
        const rows = fetched.map((row) => ({ date: fromYmd(row.date), price: row.close })).filter((row) => { const ymd = toYmd(row.date); if (existingDates.has(ymd)) return false; existingDates.add(ymd); return true; });
        result.skipped += fetched.length - rows.length; result.inserted += rows.length;
        if (rows.length) {
          await sqlQuery(em).insertInto('financial_asset_price').values(rows.map((row) => ({ date: row.date, financial_asset_key: financialAssetKey, price: row.price, volume: 0 }))).onConflict((conflict) => conflict.columns(['financial_asset_key', 'date']).doNothing()).execute();
          hasSuccessfulBackfillAttempt = true;
          earliestBackfillDate = minDate(earliestBackfillDate, fromDate);
        }
      } catch (error) { result.failed += 1; result.failures.push({ reason: error instanceof Error ? error.message : 'historical backfill failed', symbol: item.symbol }); }
    }
    if (earliestBackfillDate && hasSuccessfulBackfillAttempt) await snapshotService.backfillSnapshotsForPortfolio(input.portfolioId, earliestBackfillDate);
    return result;
  }
}

export default new HistoricalAssetPriceBackfillService();
