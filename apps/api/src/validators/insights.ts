import { z } from 'zod';

/** `GET /v1/insights` query envelope. The month is a calendar key, `YYYY-MM`. */
export const insightsQuerySchema = z.object({
  query: z.object({
    month: z
      .string()
      .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, { message: 'Month must be YYYY-MM' })
      .optional(),
  }),
});
