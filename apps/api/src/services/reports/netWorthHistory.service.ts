import netWorthService from '@service/net-worth/net-worth.service';

import { round2, toCsv } from './csv';
import type { ReportServiceInput } from './report-filters';
import { getMonthKey, resolveReportTimeZone } from './report-months';

export interface NetWorthHistoryRow {
  breakdown: {
    assets: number;
    liabilities: number;
  };
  date: string;
  netWorth: number;
}

const HISTORY_MONTHS = 12;

export function buildNetWorthHistoryCsv(rows: NetWorthHistoryRow[]): string {
  const header = ['date', 'netWorth', 'assets', 'liabilities'];
  const body = rows.map((row) => [
    row.date,
    row.netWorth.toFixed(2),
    row.breakdown.assets.toFixed(2),
    row.breakdown.liabilities.toFixed(2),
  ]);
  return toCsv(header, body);
}

export async function getNetWorthHistoryReport(input: ReportServiceInput): Promise<NetWorthHistoryRow[]> {
  const summary = await netWorthService.getNetWorthHistory(input.user, {
    granularity: 'monthly',
    months: HISTORY_MONTHS,
    toDate: input.filters.toDate ? new Date(input.filters.toDate) : undefined,
  });
  // RAD-565 — `fromDate` is an *instant*; a Lisbon viewer picking August sends
  // `2026-07-31T23:00:00Z`. Reading its month in UTC resolved to July, so a July
  // point cleared a filter for August. Resolve it in the caller's calendar.
  //
  // The points are not instants: `point.date` is a floating `YYYY-MM-DD`, so its
  // month key is a plain prefix and must not be run through a time zone.
  const fromMonthKey = input.filters.fromDate
    ? getMonthKey(new Date(input.filters.fromDate), resolveReportTimeZone(input.filters.timezone))
    : null;

  return summary.points
    .filter((point) => point.totalNetWorth != null)
    // Both keys are zero-padded `YYYY-MM`, so string ordering is chronological.
    .filter((point) => fromMonthKey === null || point.date.slice(0, 7) >= fromMonthKey)
    .map((point) => {
      const assets = (point.accountsTotal ?? 0) + (point.portfoliosTotal ?? 0);
      const liabilities = point.loansTotal ?? 0;
      return {
        breakdown: {
          assets: round2(assets),
          liabilities: round2(liabilities),
        },
        date: monthStartOf(point.date).toISOString(),
        netWorth: round2(point.totalNetWorth ?? 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function monthStartOf(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
}
