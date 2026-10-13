import { endOfDay, endOfMonth, startOfDay, startOfMonth, startOfYear, subDays, subMonths } from 'date-fns';

export type AssistantPeriodKey = 'current_month' | 'last_12_months' | 'last_90_days' | 'previous_month' | 'year_to_date';

export interface AssistantResolvedPeriod {
  end: Date;
  granularity: 'day' | 'month';
  key: AssistantPeriodKey;
  start: Date;
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantPeriodService {
  static resolve(period: AssistantPeriodKey, now = new Date()): AssistantResolvedPeriod {
    const safeNow = new Date(now);

    switch (period) {
      case 'current_month':
        return { end: endOfMonth(safeNow), granularity: 'month', key: period, start: startOfMonth(safeNow) };
      case 'last_12_months':
        return { end: endOfMonth(safeNow), granularity: 'month', key: period, start: startOfMonth(subMonths(safeNow, 11)) };
      case 'last_90_days':
        return { end: endOfDay(safeNow), granularity: 'day', key: period, start: startOfDay(subDays(safeNow, 89)) };
      case 'previous_month': {
        const previousMonth = subMonths(safeNow, 1);
        return { end: endOfMonth(previousMonth), granularity: 'month', key: period, start: startOfMonth(previousMonth) };
      }
      case 'year_to_date':
        return { end: endOfDay(safeNow), granularity: 'month', key: period, start: startOfYear(safeNow) };
    }
  }
}
