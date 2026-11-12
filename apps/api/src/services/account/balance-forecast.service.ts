import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { loadUpcomingInstallments } from '@service/installment/installment-plan.service';
import { buildRecurringSchedule, type RecurringScheduleSeries } from '@service/recurring/recurring-schedule';
import { RecurringAmountType, RecurringSeriesStatus } from '@service/recurring/recurring-types';
import { big, roundDisplay } from '@utils/money';

const DAY_MS = 86_400_000;

/** The forecast window the endpoint accepts, in whole days. */
export const MIN_BALANCE_FORECAST_DAYS = 30;
export const MAX_BALANCE_FORECAST_DAYS = 90;

/**
 * How far outside the window occurrences are read, so a payment a few days before or after its
 * expected date still settles that cycle (the same margin the occurrences endpoint uses).
 */
const OCCURRENCE_MATCH_WINDOW_MS = 11 * DAY_MS;

/** One day of a projected balance, in the series' own currency. */
export interface BalanceForecastPoint {
  /** `YYYY-MM-DD`, UTC. */
  balance: number;
  date: string;
}

/** A recurring occurrence the forecast applied. A projection, never a transaction. */
export interface BalanceForecastOccurrence {
  /** Null for a series with no account: it counts toward the household total only. */
  accountKey: null | number;
  /** A positive magnitude, as the recurring series stores it. */
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  name: string;
  seriesKey: number;
}

/**
 * An upcoming installment of a card purchase the forecast applied: a projection from the plan's
 * schedule (`services/installment/`), never a transaction. A positive magnitude, charged to its card.
 */
export interface BalanceForecastInstallment {
  accountKey: number;
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  installmentCount: number;
  installmentNumber: number;
  installmentPlanKey: number;
  name: string;
}

/** A daily balance series and its lowest point. */
export interface BalanceForecast {
  accounts: BalanceForecastAccountSeries[];
  days: number;
  /** `YYYY-MM-DD`, UTC. */
  from: string;
  /**
   * One series per currency, so a mixed-currency household is never summed into a number that
   * means nothing. A series with no account counts here only.
   */
  totals: BalanceForecastSeries[];
  /** The single total when every included account and series is in one currency; null otherwise. */
  total: BalanceForecastSeries | null;
}

export interface BalanceForecastAccountSeries extends BalanceForecastSeries {
  accountKey: number;
}

export interface BalanceForecastRequest {
  /** Only these accounts (privacy-scoped); absent means every account the caller can see. */
  accountKeys?: number[];
  /** Whole days, `MIN_BALANCE_FORECAST_DAYS`..`MAX_BALANCE_FORECAST_DAYS`. */
  days: number;
  /** The first day of the series. Defaults to today (UTC). */
  from?: Date;
  tenantKey: number;
  viewerAppuserKey: number;
}

export interface BalanceForecastSeries {
  /** False when an occurrence could not be placed honestly (no amount, or a currency mismatch). */
  complete: boolean;
  currency: string;
  lowPoint: BalanceForecastPoint | null;
  /** The balance the series starts from, or null when it cannot be computed. */
  openingBalance: null | number;
  points: BalanceForecastPoint[];
  projected: BalanceForecastOccurrence[];
  /** Upcoming card installments the series applied, next to the recurring `projected` ones. */
  projectedInstallments: BalanceForecastInstallment[];
}

export interface ForecastAccountInput {
  accountKey: number;
  balance: null | number;
  currency: string;
}

export interface ForecastInstallmentInput {
  accountKey: number;
  amount: number;
  currency: string;
  date: Date;
  installmentCount: number;
  installmentNumber: number;
  installmentPlanKey: number;
  name: string;
}

export interface ForecastOccurrenceInput {
  accountKey: null | number;
  amount: null | number;
  currency: null | string;
  date: Date;
  name: string;
  seriesKey: number;
}

export interface ProjectBalanceForecastInput {
  accounts: ForecastAccountInput[];
  days: number;
  from: Date;
  /** Upcoming installments of card purchases, each on its card. */
  installments?: ForecastInstallmentInput[];
  occurrences: ForecastOccurrenceInput[];
}

/**
 * The projected balance of the household's accounts for the next `days` days.
 *
 * Starts from each account's current balance and applies the expected recurring occurrences from
 * today on, and the upcoming installments of card purchases (a paid installment is a posted
 * transaction, already in the balance). An occurrence already matched to a real transaction is dropped by
 * `buildRecurringSchedule`, so a bill paid early never counts twice. A variable bill uses its
 * average amount and a fixed one its expected amount. Each account's series stays in the account's
 * own currency; the household total is reported per currency and only collapsed to one figure when
 * every account and series shares it.
 *
 * Accounts are read with an explicit tenant and privacy predicate, so another household's account,
 * or the other member's private one, is never part of the caller's forecast.
 */
export async function forecastBalances(em: EntityManager, request: BalanceForecastRequest): Promise<BalanceForecast> {
  assertForecastDays(request.days);
  const from = startOfUtcDay(request.from ?? new Date());
  const to = new Date(from.getTime() + (request.days - 1) * DAY_MS);

  const accounts = await em.find(
    Account,
    {
      $and: [
        { tenantKey: { tenantKey: request.tenantKey } },
        { $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: request.viewerAppuserKey } }] },
        ...(request.accountKeys && request.accountKeys.length > 0 ? [{ accountKey: { $in: request.accountKeys } }] : []),
      ],
      deletedAt: null,
    },
    { orderBy: { accountKey: 'asc' }, populate: ['currencyKey'] },
  );

  // Series on a visible account, plus the household-level ones with no account. Restricting the
  // account relation to the accounts just read is the privacy predicate: a series on the other
  // member's private account is absent because that account is.
  const series = await em.find(
    RecurringSeries,
    {
      $or: [{ accountKey: null }, { accountKey: { $in: accounts } }],
      deletedAt: null,
      status: RecurringSeriesStatus.confirmed,
      tenantKey: { tenantKey: request.tenantKey },
    },
    { populate: ['accountKey', 'currencyKey'] },
  );

  const occurrences = series.length === 0
    ? []
    : await em.find(
      RecurringOccurrence,
      {
        deletedAt: null,
        occurrenceDate: { $gte: new Date(from.getTime() - OCCURRENCE_MATCH_WINDOW_MS), $lte: new Date(to.getTime() + OCCURRENCE_MATCH_WINDOW_MS) },
        recurringSeriesKey: { $in: series },
      },
      { populate: ['currencyKey'] },
    );

  const seriesByKey = new Map(series.map((item) => [item.recurringSeriesKey, item]));
  const entries = buildRecurringSchedule(
    series.map((item) => scheduleSeries(item)),
    occurrences.map((occurrence) => ({
      amount: occurrence.amount,
      currency: occurrence.currencyKey?.code ?? null,
      date: occurrence.occurrenceDate,
      matchStatus: occurrence.matchStatus,
      seriesKey: occurrence.recurringSeriesKey.recurringSeriesKey,
    })),
    { amountFor: forecastOccurrenceAmount, from, to, today: from },
  );

  // Only what is still to come: a paid occurrence is already in the current balance.
  const projected = entries
    .filter((entry) => entry.status === 'due' || entry.status === 'projected')
    .map((entry) => {
      const item = seriesByKey.get(entry.seriesKey);
      return {
        accountKey: item?.accountKey?.accountKey ?? null,
        amount: entry.expectedAmount,
        currency: entry.currency,
        date: entry.date,
        name: entry.name,
        seriesKey: entry.seriesKey,
      };
    });

  // A card's upcoming installments, on the accounts just read (the same privacy predicate).
  const installments = accounts.length === 0
    ? []
    : (await loadUpcomingInstallments(em, { accountKeys: accounts.map((account) => account.accountKey), from, tenantKey: request.tenantKey, to }))
        .filter((installment) => !installment.paid);

  return projectBalanceForecast({
    accounts: accounts.map((account) => ({
      accountKey: account.accountKey,
      balance: account.balance ?? null,
      currency: account.currencyKey.code,
    })),
    days: request.days,
    from,
    installments,
    occurrences: projected,
  });
}

/** The forecast rule: a variable bill's average, a fixed bill's expected amount. */
export function forecastOccurrenceAmount(series: Pick<RecurringScheduleSeries, 'amountType' | 'averageAmount' | 'expectedAmount'>): null | number {
  const amount = series.amountType === RecurringAmountType.variable
    ? (series.averageAmount ?? series.expectedAmount)
    : (series.expectedAmount ?? series.averageAmount);
  return amount ?? null;
}

/**
 * The pure projection: daily balances per account and per currency, and each series' lowest point.
 *
 * An occurrence dated before the window is applied on its first day (still outstanding); one after
 * the window is outside the forecast. An occurrence that carries no amount, or a currency that
 * cannot be attributed honestly, is left out and marks its series incomplete rather than being
 * counted at face value.
 */
export function projectBalanceForecast(input: ProjectBalanceForecastInput): BalanceForecast {
  assertForecastDays(input.days);
  const from = startOfUtcDay(input.from);
  const dayKeys = Array.from({ length: input.days }, (_, offset) => isoDay(new Date(from.getTime() + offset * DAY_MS)));
  const dayIndex = new Map(dayKeys.map((key, index) => [key, index]));
  const windowStart = from.getTime();
  const accountByKey = new Map(input.accounts.map((account) => [account.accountKey, account]));
  const accountCurrencies = new Set(input.accounts.map((account) => account.currency));
  const onlyAccountCurrency = accountCurrencies.size === 1 ? ([...accountCurrencies][0] ?? null) : null;
  const skippedAccounts = new Set<null | number>();

  interface ResolvedOccurrence {
    accountKey: null | number;
    amount: number;
    currency: string;
    date: Date;
    name: string;
    seriesKey: number;
  }

  // An installment is on its card, in the card's currency; one on an account outside the forecast, or
  // in another currency, cannot be placed honestly and is left out.
  const installments = (input.installments ?? []).filter((installment) => accountByKey.get(installment.accountKey)?.currency === installment.currency && Number.isFinite(installment.amount));

  const resolved: ResolvedOccurrence[] = [];
  for (const occurrence of input.occurrences) {
    const account = occurrence.accountKey == null ? undefined : accountByKey.get(occurrence.accountKey);
    // An account-attached series belongs to its account's currency. A different one is a data
    // anomaly: leave it out rather than add a foreign amount to the account's balance.
    const currency = account
      ? (occurrence.currency == null || occurrence.currency === account.currency ? account.currency : null)
      : (occurrence.currency ?? onlyAccountCurrency);
    if (currency == null || occurrence.amount == null || !Number.isFinite(occurrence.amount)) {
      skippedAccounts.add(occurrence.accountKey ?? null);
      continue;
    }
    resolved.push({
      accountKey: occurrence.accountKey ?? null,
      amount: occurrence.amount,
      currency,
      date: occurrence.date,
      name: occurrence.name,
      seriesKey: occurrence.seriesKey,
    });
  }

  const accounts = input.accounts.map((account): BalanceForecastAccountSeries => {
    const own = resolved.filter((occurrence) => occurrence.accountKey === account.accountKey);
    const series = buildSeries({
      complete: account.balance != null && !skippedAccounts.has(account.accountKey),
      currency: account.currency,
      dayIndex,
      dayKeys,
      installments: installments.filter((installment) => installment.accountKey === account.accountKey),
      occurrences: own,
      openingBalance: account.balance,
      windowStart,
    });
    return { accountKey: account.accountKey, ...series };
  });

  const currencies = new Set<string>();
  for (const account of input.accounts) currencies.add(account.currency);
  for (const occurrence of resolved) currencies.add(occurrence.currency);

  const totals = [...currencies].sort().map((currency): BalanceForecastSeries => {
    const accountsInCurrency = input.accounts.filter((account) => account.currency === currency);
    const openingBalance = accountsInCurrency.length === 0
      ? 0
      : accountsInCurrency.every((account) => account.balance != null)
        ? accountsInCurrency.reduce((sum, account) => sum.plus(big(account.balance)), big(0)).toNumber()
        : null;
    const complete =
      openingBalance != null
      && !skippedAccounts.has(null)
      && !accountsInCurrency.some((account) => skippedAccounts.has(account.accountKey));
    const relevant = resolved.filter((occurrence) => occurrence.currency === currency);
    const relevantInstallments = installments.filter((installment) => installment.currency === currency);
    return buildSeries({ complete, currency, dayIndex, dayKeys, installments: relevantInstallments, occurrences: relevant, openingBalance, windowStart });
  });

  return {
    accounts,
    days: input.days,
    from: isoDay(from),
    total: totals.length === 1 ? (totals[0] ?? null) : null,
    totals,
  };
}

function assertForecastDays(days: number): void {
  if (!Number.isInteger(days) || days < MIN_BALANCE_FORECAST_DAYS || days > MAX_BALANCE_FORECAST_DAYS) {
    throw new RangeError(`A balance forecast covers ${MIN_BALANCE_FORECAST_DAYS} to ${MAX_BALANCE_FORECAST_DAYS} days`);
  }
}

function buildSeries(input: {
  complete: boolean;
  currency: string;
  dayIndex: Map<string, number>;
  dayKeys: string[];
  installments: ForecastInstallmentInput[];
  occurrences: { accountKey: null | number; amount: number; currency: string; date: Date; name: string; seriesKey: number }[];
  openingBalance: null | number;
  windowStart: number;
}): BalanceForecastSeries {
  if (input.openingBalance == null) {
    return {
      complete: false,
      currency: input.currency,
      lowPoint: null,
      openingBalance: null,
      points: [],
      projected: [],
      projectedInstallments: [],
    };
  }

  const amountsByDay = new Map<number, number>();
  const projected: BalanceForecastOccurrence[] = [];
  for (const occurrence of input.occurrences) {
    const key = isoDay(occurrence.date);
    const index = input.dayIndex.get(key) ?? (occurrence.date.getTime() < input.windowStart ? 0 : -1);
    if (index < 0 || index >= input.dayKeys.length) continue;
    amountsByDay.set(index, (amountsByDay.get(index) ?? 0) + occurrence.amount);
    projected.push({
      accountKey: occurrence.accountKey,
      amount: roundDisplay(occurrence.amount),
      currency: occurrence.currency,
      date: key,
      name: occurrence.name,
      seriesKey: occurrence.seriesKey,
    });
  }

  const projectedInstallments: BalanceForecastInstallment[] = [];
  for (const installment of input.installments) {
    const key = isoDay(installment.date);
    const index = input.dayIndex.get(key);
    if (index === undefined) continue;
    amountsByDay.set(index, (amountsByDay.get(index) ?? 0) + installment.amount);
    projectedInstallments.push({
      accountKey: installment.accountKey,
      amount: roundDisplay(installment.amount),
      currency: installment.currency,
      date: key,
      installmentCount: installment.installmentCount,
      installmentNumber: installment.installmentNumber,
      installmentPlanKey: installment.installmentPlanKey,
      name: installment.name,
    });
  }

  let balance = big(input.openingBalance);
  const points = input.dayKeys.map((date, index) => {
    balance = balance.minus(big(amountsByDay.get(index) ?? 0));
    return { balance: roundDisplay(balance), date };
  });
  const lowPoint = points.reduce<BalanceForecastPoint | null>(
    (lowest, point) => (lowest == null || point.balance < lowest.balance ? point : lowest),
    null,
  );

  projected.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name) || left.seriesKey - right.seriesKey);
  projectedInstallments.sort((left, right) => left.date.localeCompare(right.date) || left.installmentPlanKey - right.installmentPlanKey || left.installmentNumber - right.installmentNumber);
  return {
    complete: input.complete,
    currency: input.currency,
    lowPoint,
    openingBalance: roundDisplay(input.openingBalance),
    points,
    projected,
    projectedInstallments,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function scheduleSeries(series: RecurringSeries): RecurringScheduleSeries {
  return {
    amountType: series.amountType,
    averageAmount: series.averageAmount,
    cadence: series.cadence,
    currency: series.currencyKey?.code ?? null,
    displayName: series.displayName,
    expectedAmount: series.expectedAmount,
    expectedAmountMax: series.expectedAmountMax,
    nextExpectedAt: series.nextExpectedAt,
    recurringSeriesKey: series.recurringSeriesKey,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
