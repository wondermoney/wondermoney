import { z } from 'zod';

import { isSupportedTimeZone, REPORT_DEFAULT_TIME_ZONE } from '@service/reports/report-months';

/**
 * RAD-156 — Reports filter envelope shared by every /v1/reports endpoint.
 *
 * Express query parsing yields a plain string for single-value params and an
 * array for repeated params, so the array filters accept both and normalize.
 *
 * RAD-555 — `timezone` is the calendar a report groups its periods in. It is
 * additive and optional: a caller that omits it gets `REPORT_DEFAULT_TIME_ZONE`,
 * which is echoed back in the response `filters` so the answer says which
 * calendar it was computed in.
 */
const optionalStringArray = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return (Array.isArray(value) ? value : value.split(','))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  });

/**
 * Upper bound on `fromDate`..`toDate`, mirroring `getHistoricalPriceRequestSchema`'s
 * `MAX_HISTORICAL_PRICE_RANGE_DAYS`. Without it a caller can ask for
 * `0001-01-01`..`9999-12-31` and force a full-history aggregation per request; the `read`
 * rate-limit family (1200 / 15 min) is generous enough for one account to keep several of
 * those running continuously. Ten years covers every legitimate report a household can have
 * data for — WonderMoney has not existed for longer.
 */
export const MAX_REPORT_RANGE_DAYS = 10 * 366;

export const reportFiltersSchema = z.object({
  accountKeys: optionalStringArray,
  categoryKeys: optionalStringArray,
  currencyKey: z.string().optional(),
  fromDate: z.string().datetime({ offset: true }).optional(),
  includePending: z.coerce.boolean().optional().default(false),
  includeTransfers: z.coerce.boolean().optional().default(false),
  merchantKeys: optionalStringArray,
  timezone: z
    .string()
    .refine(isSupportedTimeZone, { message: 'timezone must be a valid IANA time zone name, e.g. Europe/Lisbon' })
    .optional()
    .default(REPORT_DEFAULT_TIME_ZONE),
  toDate: z.string().datetime({ offset: true }).optional(),
})
  // Applied to the object above rather than to a separate wrapper so that tightening any field
  // (e.g. making `fromDate`/`toDate` mandatory) stays a one-line edit inside the same literal.
  .refine(
    ({ fromDate, toDate }) => {
      if (!fromDate || !toDate) return true;
      const spanDays = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24);
      return spanDays >= 0 && spanDays <= MAX_REPORT_RANGE_DAYS;
    },
    { message: `Date range must be between 0 and ${MAX_REPORT_RANGE_DAYS} days`, path: ['toDate'] },
  );

export const reportsQuerySchema = z.object({
  query: reportFiltersSchema,
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;
