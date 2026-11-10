/**
 * How long a bank connection waits between unattended syncs, in hours. Banks may cap unattended
 * PSD2 access at four calls a day per account, so the default keeps one scheduled sync a day.
 */
export const DEFAULT_ACCOUNT_SYNC_INTERVAL_HOURS = 20;
