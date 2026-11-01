import { z } from 'zod';

import { RecurringAmountType, RecurringCadence, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

const positiveInt = z.coerce.number().int().positive();
const nullableNonNegativeNumber = z.coerce.number().nonnegative().nullable();

export const recurringListSchema = z.object({
  query: z.object({
    amountType: z.enum(RecurringAmountType).optional(),
    fromDate: z.iso.datetime().optional(),
    status: z.enum(RecurringSeriesStatus).optional(),
    toDate: z.iso.datetime().optional(),
    type: z.enum(RecurringSeriesType).optional(),
  }),
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
