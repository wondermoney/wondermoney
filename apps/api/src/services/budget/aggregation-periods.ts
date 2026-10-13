import { addDays, addMonths, addWeeks, getISOWeek, getISOWeekYear, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { z } from 'zod';

import { BadRequestError } from '@utils/errors';

const LISBON_TIME_ZONE = 'Europe/Lisbon';
export const INVALID_SCHEDULED_FOR = 'INVALID_SCHEDULED_FOR';

export interface InstantRange {
  end: Date;
  start: Date;
}

export interface LisbonBudgetPeriod {
  day: InstantRange;
  localDate: string;
  month: number;
  monthRange: InstantRange;
  scheduledFor: Date;
  year: number;
}

export interface LisbonWeeklyPeriod {
  comparisonWeek: InstantRange;
  isoWeek: number;
  isoWeekYear: number;
  month: number;
  monthRange: InstantRange;
  scheduledFor: Date;
  subjectWeek: InstantRange;
  year: number;
}

const scheduledForSchema = z.string().datetime({ offset: true });

export function getLisbonBudgetPeriod(scheduledFor: string): LisbonBudgetPeriod {
  const instant = parseScheduledFor(scheduledFor);
  const localDate = formatInTimeZone(instant, LISBON_TIME_ZONE, 'yyyy-MM-dd');
  const [year, month] = localDate.split('-').map(Number) as [number, number];
  const monthStartLocal = `${localDate.slice(0, 7)}-01T00:00:00`;
  const nextMonthLocal = formatLocalDate(addMonths(toZonedTime(fromZonedTime(monthStartLocal, LISBON_TIME_ZONE), LISBON_TIME_ZONE), 1));

  return {
    day: {
      end: fromZonedTime(`${formatLocalDate(addDays(toZonedTime(fromZonedTime(`${localDate}T00:00:00`, LISBON_TIME_ZONE), LISBON_TIME_ZONE), 1))}T00:00:00`, LISBON_TIME_ZONE),
      start: fromZonedTime(`${localDate}T00:00:00`, LISBON_TIME_ZONE),
    },
    localDate,
    month,
    monthRange: {
      end: fromZonedTime(`${nextMonthLocal}T00:00:00`, LISBON_TIME_ZONE),
      start: fromZonedTime(monthStartLocal, LISBON_TIME_ZONE),
    },
    scheduledFor: instant,
    year,
  };
}

export function getLisbonWeeklyPeriod(scheduledFor: string): LisbonWeeklyPeriod {
  const instant = parseScheduledFor(scheduledFor);
  const localInstant = toZonedTime(instant, LISBON_TIME_ZONE);
  const currentWeekStart = startOfWeek(localInstant, { weekStartsOn: 1 });
  const subjectStart = addWeeks(currentWeekStart, -1);
  const comparisonStart = addWeeks(currentWeekStart, -2);
  const budgetPeriod = getLisbonBudgetPeriod(scheduledFor);

  return {
    comparisonWeek: localRange(comparisonStart, subjectStart),
    isoWeek: getISOWeek(subjectStart),
    isoWeekYear: getISOWeekYear(subjectStart),
    month: budgetPeriod.month,
    monthRange: budgetPeriod.monthRange,
    scheduledFor: instant,
    subjectWeek: localRange(subjectStart, currentWeekStart),
    year: budgetPeriod.year,
  };
}

export function parseScheduledFor(value: string): Date {
  const parsed = scheduledForSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestError(INVALID_SCHEDULED_FOR);
  const instant = new Date(parsed.data);
  if (!Number.isFinite(instant.getTime())) throw new BadRequestError(INVALID_SCHEDULED_FOR);
  return instant;
}

function formatLocalDate(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function localRange(start: Date, end: Date): InstantRange {
  return {
    end: fromZonedTime(`${formatLocalDate(end)}T00:00:00`, LISBON_TIME_ZONE),
    start: fromZonedTime(`${formatLocalDate(start)}T00:00:00`, LISBON_TIME_ZONE),
  };
}
