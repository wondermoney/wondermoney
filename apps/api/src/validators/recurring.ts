import { z } from 'zod';

import { MAX_RECURRING_OCCURRENCE_RANGE_DAYS } from '@service/recurring/recurring-schedule';
import { RecurringAmountType, RecurringCadence, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

const DAY_MS = 86_400_000;
const positiveInt = z.coerce.number().int().positive();
const nullableNonNegativeNumber = z.coerce.number().nonnegative().nullable();

/** A calendar day (`YYYY-MM-DD`), read as midnight UTC, as the occurrences endpoint takes it. */
const calendarDay = z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));

export const recurringListSchema = z.object({
  query: z.object({
    amountType: z.enum(RecurringAmountType).optional(),
    fromDate: z.iso.datetime().optional(),
    status: z.enum(RecurringSeriesStatus).optional(),
    toDate: z.iso.datetime().optional(),
    type: z.enum(RecurringSeriesType).optional(),
  }),
});

export const recurringOccurrencesQuerySchema = z
  .object({
    query: z.object({
      from: calendarDay,
      to: calendarDay,
    }),
  })
  .refine(({ query }) => query.from.getTime() <= query.to.getTime(), {
    message: 'from must not be after to',
    path: ['query', 'from'],
  })
  .refine(({ query }) => (query.to.getTime() - query.from.getTime()) / DAY_MS + 1 <= MAX_RECURRING_OCCURRENCE_RANGE_DAYS, {
    message: `Range must not exceed ${MAX_RECURRING_OCCURRENCE_RANGE_DAYS} days`,
    path: ['query', 'to'],
  });

export const recurringIdParamSchema = z.object({
  params: z.object({
    recurringSeriesId: positiveInt,
  }),
});

export const updateRecurringSchema = z.object({
  body: z.object({
    amountType: z.enum(RecurringAmountType).optional(),
    cadence: z.enum(RecurringCadence).optional(),
    categoryKey: positiveInt.nullable().optional(),
    displayName: z.string().min(1).max(255).optional(),
    expectedAmount: nullableNonNegativeNumber.optional(),
    expectedAmountMax: nullableNonNegativeNumber.optional(),
    expectedAmountMin: nullableNonNegativeNumber.optional(),
    status: z.enum(RecurringSeriesStatus).optional(),
    type: z.enum(RecurringSeriesType).optional(),
  }).refine((body) => body.expectedAmountMin == null || body.expectedAmountMax == null || body.expectedAmountMin <= body.expectedAmountMax, {
    message: 'expectedAmountMin must be less than or equal to expectedAmountMax',
    path: ['expectedAmountMin'],
  }),
  params: z.object({
    recurringSeriesId: positiveInt,
  }),
});
