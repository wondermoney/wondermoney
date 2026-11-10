import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

const DAY_MS = 86_400_000;

/** An ISO currency code, upper-cased. Whether WonderMoney knows it is checked against the database. */
const currencyCode = z
  .string()
  .trim()
  .regex(/^[a-z]{3}$/i, 'Currency must be a three-letter code')
  .transform((code) => code.toUpperCase());

/**
 * A calendar day, `YYYY-MM-DD`, as 00:00 UTC. A real date (no 30 February), and no later than
 * tomorrow in UTC, so a member ahead of UTC can still set today's rate.
 */
const overrideDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .transform((value, context) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      context.addIssue({ code: 'custom', message: 'Date is not a calendar day' });
      return z.NEVER;
    }
    const today = new Date();
    const tomorrow = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + DAY_MS;
    if (date.getTime() > tomorrow) {
      context.addIssue({ code: 'custom', message: 'Date cannot be in the future' });
      return z.NEVER;
    }
    return date;
  });

/** Units of the target currency for one unit of the source: positive and finite. */
const overrideRate = z.number().positive('Rate must be greater than zero').max(1_000_000_000);

export const createExchangeRateOverrideRequestSchema = z.object({
  body: z
    .object({
      date: overrideDay,
      fromCurrency: currencyCode,
      rate: overrideRate,
      toCurrency: currencyCode,
    })
    .refine((body) => body.fromCurrency !== body.toCurrency, { message: 'Pick two different currencies', path: ['toCurrency'] }),
});

export const updateExchangeRateOverrideRequestSchema = z.object({
  body: z
    .object({
      date: overrideDay.optional(),
      rate: overrideRate.optional(),
    })
    .refine((body) => body.date !== undefined || body.rate !== undefined, { message: 'Nothing to change' }),
  params: z.object({
    overrideId: positiveIntId,
  }),
});

export const deleteExchangeRateOverrideRequestSchema = z.object({
  params: z.object({
    overrideId: positiveIntId,
  }),
});
