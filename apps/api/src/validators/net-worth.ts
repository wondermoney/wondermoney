import { z } from 'zod';

export const netWorthHistoryQuerySchema = z.object({
  query: z.object({
    granularity: z.enum(['monthly']).default('monthly').optional(),
    months: z.coerce.number().int().min(2).max(12).default(6).optional(),
    toDate: z.string().date().optional(),
  }),
});
