/**
 * How long a bank connection waits between unattended syncs, in hours. Banks may cap unattended
 * PSD2 access at four calls a day per account, so the default keeps one scheduled sync a day.
 */
export const DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS = 20;

/**
 * The same interval, as configured by `BANK_SYNC_MIN_INTERVAL_HOURS`.
 *
 * Validated at worker start-up (`config/configuration.ts`), so in a running worker this only ever
 * sees a finite positive number or nothing. The throw is the guard for callers outside that
 * start-up path (tests, scripts): silently falling back to 20 would hide a typo behind a schedule
 * that spends the bank's quota.
 */
export function bankSyncMinIntervalHours(value: string | undefined = process.env['BANK_SYNC_MIN_INTERVAL_HOURS']): number {
  if (value === undefined || value.trim() === '') return DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('BANK_SYNC_MIN_INTERVAL_HOURS must be a finite positive number of hours');
  return parsed;
}
