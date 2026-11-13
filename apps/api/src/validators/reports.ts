import { z } from 'zod';

import { MEMBER_FILTER_VALUE } from '@service/household/member-attribution';
import { isSupportedTimeZone, REPORT_DEFAULT_TIME_ZONE } from '@service/reports/report-months';

/**
 * Reports filter envelope shared by every /v1/reports endpoint.
 *
 * Express query parsing yields a plain string for single-value params and an
 * array for repeated params, so the array filters accept both and normalize.
 *
 * `timezone` is the calendar a report groups its periods in. It is
 * additive and optional: a caller that omits it gets `REPORT_DEFAULT_TIME_ZONE`,
 * which is echoed back in the response `filters` so the answer says which
 * calendar it was computed in.
 */
const optionalStringArray = z
  .union([z.array(z.string()), z.string()])
  .transform((value) => (Array.isArray(value) ? value : value.split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0))
  .optional();

/** Like `optionalStringArray`, but every entry must be a positive integer key. */
const optionalKeyArray = optionalStringArray.refine((keys) => keys === undefined || keys.every((key) => /^[1-9]\d*$/.test(key)), { message: 'Keys must be positive integers' });

/**
 * An on/off switch as a query string carries it: `true`/`false` (or `1`/`0`), off when absent.
 * `z.coerce.boolean()` would read the string `false` as on, as it reads any non-empty string.
 */
const querySwitch = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .default(false)
  .transform((value) => value === true || value === 'true' || value === '1');

/**
 * Upper bound on `fromDate`..`toDate`, mirroring `getHistoricalPriceRequestSchema`'s
 * `MAX_HISTORICAL_PRICE_RANGE_DAYS`. Without it a caller can ask for
 * `0001-01-01`..`9999-12-31` and force a full-history aggregation per request; the `read`
 * rate-limit family (1200 / 15 min) is generous enough for one account to keep several of
 * those running continuously. Ten years covers every legitimate report a household can have
 * data for — WonderMoney has not existed for longer.
 */
export const MAX_REPORT_RANGE_DAYS = 10 * 366;

/**
 * Members' appuser keys, or `shared` for the household's joint money (`member-attribution.ts`); a
 * row counts when it is attributed to any of them.
 */
export const memberKeysFilter = optionalStringArray.refine((keys) => keys === undefined || keys.every((key) => MEMBER_FILTER_VALUE.test(key)), { message: 'Member keys must be positive integers or "shared"' });

export const reportFiltersSchema = z.object({
  accountKeys: optionalStringArray,
  categoryKeys: optionalStringArray,
  currencyKey: z.string().optional(),
  fromDate: z.iso.datetime({ offset: true }).optional(),
  includePending: querySwitch,
  includeTransfers: querySwitch,
  /** Only what these members spent and earned, or Shared; see `memberKeysFilter`. */
  memberKeys: memberKeysFilter,
  merchantKeys: optionalStringArray,
  /** Tag keys; a transaction counts when it carries any of them. */
  tagKeys: optionalKeyArray,
  timezone: z
    .string()
    .refine(isSupportedTimeZone, { message: 'timezone must be a valid IANA time zone name, e.g. Europe/Lisbon' })
    .optional()
    .default(REPORT_DEFAULT_TIME_ZONE),
  toDate: z.iso.datetime({ offset: true }).optional(),
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

/** A calendar month key, `YYYY-MM`, as the month-comparison report's pickers send it. */
const monthKeySchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, { message: 'Month must be YYYY-MM' });

/**
 * The month-comparison envelope: the shared report filters (accounts, currency,
 * timezone, tags, ...) plus the two months to compare. The months replace the
 * date range, so `fromDate`/`toDate` are accepted but ignored by the report.
 */
export const monthComparisonQuerySchema = z.object({
  query: reportFiltersSchema.extend({ base: monthKeySchema, compare: monthKeySchema }),
});

export type MonthComparisonFilters = z.infer<typeof monthComparisonQuerySchema>['query'];

/**
 * The spending-vs-normal envelope: the shared report filters plus the one month to read. The
 * month replaces the date range (accepted but ignored), and the report's calendar is the
 * `timezone` filter, so the same month means the same days for both the report and its links.
 */
export const spendingVsNormalQuerySchema = z.object({
  query: reportFiltersSchema.extend({ month: monthKeySchema }),
});

export type SpendingVsNormalFilters = z.infer<typeof spendingVsNormalQuerySchema>['query'];
