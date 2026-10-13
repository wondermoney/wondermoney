import { startOfYear, subDays, subMonths } from 'date-fns';

import type { Period } from './portfolio-dashboard.service';

export function calculateCostBasis(holdings: { averageBuyPrice: number; quantity: number }[]): number {
  return holdings.reduce((sum, h) => sum + h.averageBuyPrice * h.quantity, 0);
}

export function getPeriodStartDate(period: Period, firstTransactionDate?: Date): Date {
  const now = new Date();

  switch (period) {
    case '1M':
      return subMonths(now, 1);
    case '1Y':
      return subDays(now, 365);
    case '3M':
      return subMonths(now, 3);
    case '6M':
      return subMonths(now, 6);
    case 'ALL':
      return firstTransactionDate ?? subDays(now, 365 * 10); // Default to 10 years if no transaction
    case 'YTD':
      return startOfYear(now);
    default:
      return startOfYear(now);
  }
}
