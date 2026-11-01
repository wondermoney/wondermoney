import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/app';
import { Account } from '@entity/Account';
import { Currency } from '@entity/Currency';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { excludeExpired } from '@service/transaction/transaction-status';

import { classifyAmountType, detectCadence, inferRecurringSeriesType, normalizeRecurringMerchant, scoreRecurringCandidate } from './recurring-detection.utils';
import { RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus, RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from './recurring-types';

/**
 * How far back recurrence detection looks. Bounds what was an unbounded whole-tenant
 * scan; 18 months covers annual series plus a full repeat, which is the longest
 * cadence the detector recognises.
 */
const RECURRING_DETECTION_LOOKBACK_MONTHS = 18;

export interface RecurringCandidate {
  accountKey?: number;
  amountType: RecurringAmountType;
  averageAmount: number;
  cadence: RecurringCadence;
  cadenceConfidence: number;
  confidenceScore: number;
  currencyKey?: number;
  displayName: string;
  expectedAmount?: number;
  expectedAmountMax?: number;
  expectedAmountMin?: number;
  firstSeenAt: Date;
  lastAmount: number;
  lastSeenAt: Date;
  nextExpectedAt?: Date;
  normalizedMerchantKey: string;
  occurrenceCount: number;
  status: RecurringSeriesStatus;
  transactionKeys: number[];
  type: RecurringSeriesType;
}

interface AmountCurrencyResolution {
  amount: null | number;
  currencyKey?: number;
}

interface BuildRecurringCandidatesOptions {
  referenceDate?: Date;
}

interface TransactionLike {
  accountKey?: number | { accountKey?: number };
  appuserCurrencyKey?: null | number | { currencyKey?: number };
  appuserSettlementAmount?: null | number;
  description?: null | string;
  settlementAmount?: null | number;
  settlementCurrencyKey?: null | number | { currencyKey?: number };
  transactionDate?: Date | null;
  transactionKey: number;
  transactionMerchantKey?: null | { name?: null | string };
}

interface TransactionWithDate extends TransactionLike {
  transactionDate: Date;
}

const RECENT_DAYS_THRESHOLD = 60;

export function buildRecurringCandidatesFromTransactions(transactions: TransactionLike[], options: BuildRecurringCandidatesOptions = {}): RecurringCandidate[] {
  const referenceDate = options.referenceDate ?? new Date();
  const grouped = new Map<string, TransactionLike[]>();

  for (const transaction of transactions) {
    const merchantLabel = getMerchantLabel(transaction);
    const normalizedMerchantKey = normalizeRecurringMerchant(merchantLabel);
    const amount = getAmount(transaction);
    if (!normalizedMerchantKey || amount === null || amount >= 0 || !hasTransactionDate(transaction)) continue;

    const existing = grouped.get(getGroupKey(transaction, normalizedMerchantKey)) ?? [];
    existing.push(transaction);
    grouped.set(getGroupKey(transaction, normalizedMerchantKey), existing);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [groupKey, group] of grouped.entries()) {
    if (group.length < 3) continue;

    const datedTransactions = group.filter(hasTransactionDate);
    if (datedTransactions.length < 3) continue;

    const sorted = [...datedTransactions].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
    if (sorted.length === 0) continue;

    const firstTransaction = sorted[0];
    const lastTransaction = sorted[sorted.length - 1];
    if (!firstTransaction || !lastTransaction) continue;
    const dates = sorted.map((transaction) => transaction.transactionDate);
    const cadenceMatch = detectCadence(dates);
    if (!cadenceMatch) continue;

    const amounts = sorted.map((transaction) => Math.abs(getAmount(transaction) ?? 0));
    const amountType = classifyAmountType(amounts);
    const normalizedMerchantKey = groupKey.split('|')[0] ?? '';
    const displayName = getMerchantLabel(firstTransaction) ?? normalizedMerchantKey;
    const firstSeenAt = firstTransaction.transactionDate;
    const lastSeenAt = lastTransaction.transactionDate;
    const transactionKeys = sorted.map((transaction) => transaction.transactionKey);
    const seenRecently = referenceDate.getTime() - lastSeenAt.getTime() <= RECENT_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
    const confidenceScore = scoreRecurringCandidate({
      amountType,
      hasKnownCadence: true,
      hasMerchantKey: true,
      hasRecurringFriendlyCategory: false,
      occurrenceCount: sorted.length,
      seenRecently,
    });

    const firstTransactionResolution = resolveAmountCurrency(firstTransaction);
    const type = inferRecurringSeriesType(normalizedMerchantKey, cadenceMatch.cadence);
    const candidateBase = {
      accountKey: getAccountKey(firstTransaction),
      cadence: cadenceMatch.cadence,
      cadenceConfidence: cadenceMatch.confidence,
      confidenceScore,
      currencyKey: firstTransactionResolution.currencyKey,
      displayName,
      firstSeenAt,
      lastSeenAt,
      normalizedMerchantKey,
      occurrenceCount: sorted.length,
      status: RecurringSeriesStatus.candidate,
      transactionKeys,
    };

    if (amountType === RecurringAmountType.fixed) {
      const expectedAmount = Math.round((amounts.at(-1) ?? 0) * 100) / 100;
      const averageAmount = Number((amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length).toFixed(2));
      const lastAmount = Number((amounts.at(-1) ?? 0).toFixed(2));
      candidates.push({
        ...candidateBase,
        amountType,
        averageAmount,
        expectedAmount,
        expectedAmountMax: undefined,
        expectedAmountMin: undefined,
        lastAmount,
        nextExpectedAt: getNextExpectedAt(lastSeenAt, cadenceMatch.cadence, referenceDate),
        type,
      });
      continue;
    }

    const expectedAmountMin = Number(Math.min(...amounts).toFixed(2));
    const expectedAmountMax = Number(Math.max(...amounts).toFixed(2));
    const averageAmount = Number((amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length).toFixed(2));
    const lastAmount = Number((amounts.at(-1) ?? 0).toFixed(2));

    candidates.push({
      ...candidateBase,
      amountType,
      averageAmount,
      expectedAmount: undefined,
      expectedAmountMax,
      expectedAmountMin,
      lastAmount,
      nextExpectedAt: getNextExpectedAt(lastSeenAt, cadenceMatch.cadence, referenceDate),
      type,
    });
  }

  return candidates;
}

export async function detectRecurringCandidatesForTenant(tenantKey: number, options: BuildRecurringCandidatesOptions = {}): Promise<{ created: number; skipped: number; updated: number }> {
  return DI.em.transactional(async (em) => {
    await acquireRecurringDetectionLock(tenantKey, em);
    const referenceDate = options.referenceDate ?? new Date();
    // Bounded by a lookback window: an unbounded whole-tenant scan with four populates would
    // run synchronously inside `em.transactional` while holding the advisory lock — on the
    // request path of every transaction write. Recurrence is inferred from cadence over
    // recent history, so a lookback window loses no signal: a series whose last occurrence
    // predates the window is not "recurring" in any useful sense, and `next_expected_at`
    // is driven by the recent occurrences anyway.
    const lookbackStart = new Date(referenceDate);
    lookbackStart.setMonth(lookbackStart.getMonth() - RECURRING_DETECTION_LOOKBACK_MONTHS);
    // An EXPIRED charge never happened, so it is no occurrence. A PENDING one is: its
    // booking replaces it in place.
    const transactions = await em.find(Transaction, excludeExpired({
      deletedAt: null,
      tenantKey: getTenantRef(tenantKey, em),
      transactionDate: { $gte: lookbackStart },
    }), {
      orderBy: { transactionDate: 'asc' },
      populate: ['transactionMerchantKey', 'accountKey', 'settlementCurrencyKey', 'appuserCurrencyKey'],
    });
    const transactionByKey = new Map(transactions.map((transaction) => [transaction.transactionKey, transaction]));
    const candidates = buildRecurringCandidatesFromTransactions(transactions, { referenceDate });
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const existing = await em.findOne(RecurringSeries, {
        accountKey: getAccountRefOrNull(candidate.accountKey, em),
        currencyKey: getCurrencyRefOrNull(candidate.currencyKey, em),
        deletedAt: null,
        normalizedMerchantKey: candidate.normalizedMerchantKey,
        tenantKey: getTenantRef(tenantKey, em),
      });
      if (existing?.status === RecurringSeriesStatus.dismissed) { skipped += 1; continue; }

      const series = existing ?? em.create(RecurringSeries, { tenantKey: getTenantRef(tenantKey, em) }, { partial: true });
      const isDetectorOwnedUpdate = !existing || (existing.status === RecurringSeriesStatus.candidate && existing.source !== RecurringSeriesSource.user_created);
      if (!existing) {
        created += 1;
        series.source = RecurringSeriesSource.detected;
        series.status = RecurringSeriesStatus.candidate;
      } else {
        updated += 1;
        series.status = existing.status;
      }

      const firstTx = transactionByKey.get(candidate.transactionKeys[0] ?? -1);
      const resolution = firstTx ? resolveAmountCurrency(firstTx) : { amount: null };
      if (isDetectorOwnedUpdate) {
        Object.assign(series, {
          amountType: candidate.amountType,
          averageAmount: candidate.averageAmount,
          cadence: candidate.cadence,
          cadenceConfidence: candidate.cadenceConfidence,
          confidenceScore: candidate.confidenceScore,
          displayName: candidate.displayName,
          expectedAmount: candidate.expectedAmount,
          expectedAmountMax: candidate.expectedAmountMax,
          expectedAmountMin: candidate.expectedAmountMin,
          firstSeenAt: candidate.firstSeenAt,
          lastAmount: candidate.lastAmount,
          lastSeenAt: candidate.lastSeenAt,
          nextExpectedAt: candidate.nextExpectedAt,
          normalizedMerchantKey: candidate.normalizedMerchantKey,
          occurrenceCount: candidate.occurrenceCount,
          type: candidate.type,
        });
        if (resolution.currencyKey !== undefined) series.currencyKey = getCurrencyRef(resolution.currencyKey, em);
        if (candidate.accountKey !== undefined) series.accountKey = getAccountRef(candidate.accountKey, em);
      } else {
        series.lastSeenAt = candidate.lastSeenAt;
        series.occurrenceCount = candidate.occurrenceCount;
        series.confidenceScore = candidate.confidenceScore;
        series.cadenceConfidence = candidate.cadenceConfidence;
        series.nextExpectedAt = getNextExpectedAt(
          candidate.lastSeenAt,
          resolveRecurringCadence(series.cadence, candidate.cadence),
          referenceDate,
        );
      }

      if (!existing) {
        // New series cannot have occurrences before flush, so skip existence checks here.
        for (const transactionKey of candidate.transactionKeys) {
          const transaction = transactionByKey.get(transactionKey);
          if (!transaction?.transactionDate) continue;
          const txResolution = resolveAmountCurrency(transaction);
          const occurrence = em.create(RecurringOccurrence, {
            amount: Math.abs(txResolution.amount ?? 0) || null,
            currencyKey: txResolution.currencyKey !== undefined ? getCurrencyRef(txResolution.currencyKey, em) : undefined,
            matchStatus: RecurringOccurrenceMatchStatus.matched,
            occurrenceDate: transaction.transactionDate,
            recurringSeriesKey: series,
            transactionKey: transaction,
          } as RequiredEntityData<RecurringOccurrence>);
          em.persist(occurrence);
        }
      } else {
        const existingOccurrences = await em.find(RecurringOccurrence, {
          deletedAt: null,
          recurringSeriesKey: series,
          transactionKey: candidate.transactionKeys,
        } as FilterQuery<RecurringOccurrence>);
        const existingOccurrenceKeys = new Set(existingOccurrences.map((occurrence) => occurrence.transactionKey?.transactionKey ?? occurrence.transactionKey));

        for (const transactionKey of candidate.transactionKeys) {
          const transaction = transactionByKey.get(transactionKey);
          if (!transaction?.transactionDate) continue;
          if (existingOccurrenceKeys.has(transactionKey)) continue;
          const txResolution = resolveAmountCurrency(transaction);
          const occurrence = em.create(RecurringOccurrence, {
            amount: Math.abs(txResolution.amount ?? 0) || undefined,
            currencyKey: txResolution.currencyKey !== undefined ? getCurrencyRef(txResolution.currencyKey, em) : undefined,
            matchStatus: RecurringOccurrenceMatchStatus.matched,
            occurrenceDate: transaction.transactionDate,
            recurringSeriesKey: series,
            transactionKey: transaction,
          } as RequiredEntityData<RecurringOccurrence>);
          em.persist(occurrence);
        }
      }
      em.persist(series);
    }

    await em.execute(
      'update "tenant" set "recurring_detection_last_run_at" = ? where "tenant_key" = ?',
      [referenceDate, tenantKey],
    );
    await em.flush();
    return { created, skipped, updated };
  });
}

/*
 * Serialises detection runs for one household until the run's transaction ends. `em.execute`
 * runs on the transaction's own connection; `em.getConnection().execute()` took the lock on a
 * separate pooled connection in autocommit, where it was released the moment it was granted, so
 * two overlapping runs each created the same series.
 */
async function acquireRecurringDetectionLock(tenantKey: number, em: EntityManager) {
  await em.execute('select pg_advisory_xact_lock(?)', [tenantKey]);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const dayOfMonth = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  next.setUTCDate(Math.min(dayOfMonth, getDaysInMonth(next)));
  return next;
}

function getAccountKey(transaction?: TransactionLike): number | undefined {
  const accountKey = transaction?.accountKey;
  return typeof accountKey === 'number' ? accountKey : accountKey?.accountKey;
}

function getAccountRef(accountKey: number, em = DI.em) {
  return em.getReference(Account, { accountKey } as unknown as Account);
}

function getAccountRefOrNull(accountKey: number | undefined, em = DI.em): null | ReturnType<typeof getAccountRef> {
  if (!accountKey) return null;
  return getAccountRef(accountKey, em);
}

function getAmount(transaction: TransactionLike): null | number {
  const amount = resolveAmountCurrency(transaction).amount;
  if (amount === null) return null;
  return amount;
}

function getCurrencyRef(currencyKey: number, em = DI.em) {
  return em.getReference(Currency, { currencyKey } as unknown as Currency);
}

function getCurrencyRefOrNull(currencyKey: number | undefined, em = DI.em): null | ReturnType<typeof getCurrencyRef> {
  if (currencyKey === undefined) return null;
  return getCurrencyRef(currencyKey, em);
}

function getDaysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function getGroupKey(transaction: TransactionLike, normalizedMerchantKey: string): string {
  const resolution = resolveAmountCurrency(transaction);
  return [normalizedMerchantKey, getAccountKey(transaction) ?? '', resolution.currencyKey ?? ''].join('|');
}

function getMerchantLabel(transaction: TransactionLike): string | undefined {
  const description = transaction.description?.trim();
  if (description) return description;
  const merchantName = transaction.transactionMerchantKey?.name?.trim();
  return merchantName || undefined;
}

function getNextCadenceDate(lastSeenAt: Date, cadence: RecurringCadence): Date {
  const next = new Date(lastSeenAt);
  switch (cadence) {
    case RecurringCadence.biweekly:
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case RecurringCadence.monthly:
      return addMonths(next, 1);
    case RecurringCadence.quarterly:
      return addMonths(next, 3);
    case RecurringCadence.weekly:
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case RecurringCadence.yearly:
      return addMonths(next, 12);
  }
}

function getNextExpectedAt(lastSeenAt: Date, cadence: RecurringCadence, referenceDate: Date): Date {
  let next = getNextCadenceDate(lastSeenAt, cadence);
  while (next.getTime() < referenceDate.getTime()) {
    next = getNextCadenceDate(next, cadence);
  }
  return next;
}

function getResolvedCurrencyKey(currencyLike?: null | number | { currencyKey?: number }): number | undefined {
  if (typeof currencyLike === 'number') return currencyLike;
  return currencyLike?.currencyKey;
}

function getTenantRef(tenantKey: number, em = DI.em) {
  return em.getReference(Tenant, { tenantKey } as unknown as Tenant);
}

function hasTransactionDate(transaction: TransactionLike): transaction is TransactionWithDate {
  return transaction.transactionDate !== null && transaction.transactionDate !== undefined;
}

function resolveAmountCurrency(transaction: TransactionLike): AmountCurrencyResolution {
  if (transaction.appuserSettlementAmount !== null && transaction.appuserSettlementAmount !== undefined) {
    return { amount: transaction.appuserSettlementAmount, currencyKey: getResolvedCurrencyKey(transaction.appuserCurrencyKey) };
  }
  return { amount: transaction.settlementAmount ?? null, currencyKey: getResolvedCurrencyKey(transaction.settlementCurrencyKey) };
}

function resolveRecurringCadence(
  value: unknown,
  fallback: RecurringCadence,
): RecurringCadence {
  return Object.values(RecurringCadence).includes(value as RecurringCadence)
    ? (value as RecurringCadence)
    : fallback;
}
