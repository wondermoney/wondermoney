import { z } from 'zod';

import { RecurringAmountType, RecurringCadence, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';

const positiveInt = z.coerce.number().int().positive();
const nullableNonNegativeNumber = z.coerce.number().finite().nonnegative().nullable();

export const recurringListSchema = z.object({
  query: z.object({
    amountType: z.nativeEnum(RecurringAmountType).optional(),
    fromDate: z.string().datetime().optional(),
    status: z.nativeEnum(RecurringSeriesStatus).optional(),
    toDate: z.string().datetime().optional(),
    type: z.nativeEnum(RecurringSeriesType).optional(),
  }),
});

export const recurringIdParamSchema = z.object({
  params: z.object({
    recurringSeriesId: positiveInt,
  }),
});

export const updateRecurringSchema = z.object({
  body: z.object({
    amountType: z.nativeEnum(RecurringAmountType).optional(),
    cadence: z.nativeEnum(RecurringCadence).optional(),
    categoryKey: positiveInt.nullable().optional(),
    displayName: z.string().min(1).max(255).optional(),
    expectedAmount: nullableNonNegativeNumber.optional(),
    expectedAmountMax: nullableNonNegativeNumber.optional(),
    expectedAmountMin: nullableNonNegativeNumber.optional(),
    status: z.nativeEnum(RecurringSeriesStatus).optional(),
    type: z.nativeEnum(RecurringSeriesType).optional(),
  }).refine((body) => body.expectedAmountMin == null || body.expectedAmountMax == null || body.expectedAmountMin <= body.expectedAmountMax, {
    message: 'expectedAmountMin must be less than or equal to expectedAmountMax',
    path: ['expectedAmountMin'],
  }),
  params: z.object({
    recurringSeriesId: positiveInt,
  }),
});
