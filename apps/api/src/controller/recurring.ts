import { type FilterQuery } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Tenant } from '@entity/Tenant';
import { detectRecurringCandidatesForTenant } from '@service/recurring/recurring-detection.service';
import { RecurringAmountType, RecurringCadence, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';
import { findAssignableCategory } from '@service/transaction/household-category';
import { BadRequestError, NotFoundError } from '@utils/errors';
import { zParse } from '@validators/parser';
import { recurringIdParamSchema, recurringListSchema, updateRecurringSchema } from '@validators/recurring';

interface AuthedRequest extends Request {
  appuser?: Appuser;
  tenant?: Tenant;
  user?: Appuser;
}

interface SummaryTotals {
  billMaxTotal: number;
  billMinTotal: number;
  count: number;
  fixedTotal: number;
  monthlyMaxTotal: number;
  monthlyMinTotal: number;
  monthlyTotal: number;
  subscriptionMaxTotal: number;
  subscriptionMinTotal: number;
  variableMaxTotal: number;
  variableMinTotal: number;
}

export async function confirmRecurringSeries(req: AuthedRequest, res: Response) {
  const recurringSeries = await getRecurringSeriesOrFail(req);
  recurringSeries.status = RecurringSeriesStatus.confirmed;
  await DI.em.flush();
  return res.sendStatus(200);
}

export async function detectRecurring(req: AuthedRequest, res: Response) {
  const tenantKey = await resolveTenantKey(req);
  const result = await detectRecurringCandidatesForTenant(tenantKey);
  return res.json(result);
}

export async function dismissRecurringSeries(req: AuthedRequest, res: Response) {
  const recurringSeries = await getRecurringSeriesOrFail(req);
  recurringSeries.status = RecurringSeriesStatus.dismissed;
  await DI.em.flush();
  return res.sendStatus(200);
}

export async function getRecurringItems(req: AuthedRequest, res: Response) {
  const {
    query: { amountType, fromDate, status, toDate, type },
  } = await zParse(recurringListSchema, req);
  const tenantKey = await resolveTenantKey(req);
  const items = await DI.em.find(
    RecurringSeries,
    buildRecurringWhere(tenantKey, {
      ...(amountType && { amountType }),
      ...(status && { status }),
      ...(type && { type }),
      ...(fromDate || toDate
        ? {
            nextExpectedAt: {
              ...(fromDate && { $gte: new Date(fromDate) }),
              ...(toDate && { $lte: new Date(toDate) }),
            },
          }
        : {}),
    }),
    { orderBy: { nextExpectedAt: 'asc' }, populate: ['accountKey', 'categoryKey', 'currencyKey'] },
  );
  return res.json({ items: items.map(recurringDto) });
}

export async function getRecurringSummary(req: AuthedRequest, res: Response) {
  const tenantKey = await resolveTenantKey(req);
  const [items, tenant] = await Promise.all([
    DI.em.find(RecurringSeries, buildRecurringWhere(tenantKey), {
      populate: ['currencyKey'],
    }),
    DI.em.findOne(Tenant, { tenantKey }),
  ]);
  const summary = items.reduce(
    (acc, series) => {
      const totals = summaryFor(series);
      return {
        billMaxTotal: acc.billMaxTotal + totals.billMaxTotal,
        billMinTotal: acc.billMinTotal + totals.billMinTotal,
        currencyTotals: mergeCurrencyTotals(acc.currencyTotals, currencyTotalsFor(series)),
        detectedIncludedCount: acc.detectedIncludedCount + totals.detectedIncludedCount,
        fixedTotal: acc.fixedTotal + totals.fixedTotal,
        monthlyMaxTotal: acc.monthlyMaxTotal + totals.monthlyMaxTotal,
        monthlyMinTotal: acc.monthlyMinTotal + totals.monthlyMinTotal,
        monthlyTotal: acc.monthlyTotal + totals.monthlyTotal,
        needsReviewCount: acc.needsReviewCount + totals.needsReviewCount,
        subscriptionMaxTotal: acc.subscriptionMaxTotal + totals.subscriptionMaxTotal,
        subscriptionMinTotal: acc.subscriptionMinTotal + totals.subscriptionMinTotal,
        variableMaxTotal: acc.variableMaxTotal + totals.variableMaxTotal,
        variableMinTotal: acc.variableMinTotal + totals.variableMinTotal,
      };
    },
    {
      billMaxTotal: 0,
      billMinTotal: 0,
      currencyTotals: {},
      detectedIncludedCount: 0,
      fixedTotal: 0,
      monthlyMaxTotal: 0,
      monthlyMinTotal: 0,
      monthlyTotal: 0,
      needsReviewCount: 0,
      subscriptionMaxTotal: 0,
      subscriptionMinTotal: 0,
      variableMaxTotal: 0,
      variableMinTotal: 0,
    },
  );
  return res.json({
    ...summary,
    lastDetectedAt: tenant?.recurringDetectionLastRunAt ?? null,
  });
}

export async function updateRecurringSeries(req: AuthedRequest, res: Response) {
  const {
    body: { categoryKey, ...updates },
  } = await zParse(updateRecurringSchema, req);
  const recurringSeries = await getRecurringSeriesOrFail(req);
  Object.assign(recurringSeries, updates);
  if (categoryKey !== undefined) {
    recurringSeries.categoryKey =
      categoryKey === null ? undefined : await loadRecurringCategoryOrFail(req, categoryKey);
  }
  await DI.em.flush();
  return res.json({ recurringSeries: recurringDto(recurringSeries) });
}

function buildRecurringWhere(tenantKey: number, filters: FilterQuery<RecurringSeries> = {}) {
  return Object.assign({ deletedAt: null, tenantKey }, filters);
}

function currencyKeyFor(series: RecurringSeries) {
  const code = series.currencyKey?.code;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : 'unknown';
}

function currencyTotalsFor(series: RecurringSeries) {
  const key = currencyKeyFor(series);
  const included =
    series.status === RecurringSeriesStatus.confirmed ||
    (series.status === RecurringSeriesStatus.candidate && series.confidenceScore >= 90);
  const totals: Record<string, SummaryTotals> = {
    [key]: {
      billMaxTotal: 0,
      billMinTotal: 0,
      count: included ? 1 : 0,
      fixedTotal: 0,
      monthlyMaxTotal: 0,
      monthlyMinTotal: 0,
      monthlyTotal: 0,
      subscriptionMaxTotal: 0,
      subscriptionMinTotal: 0,
      variableMaxTotal: 0,
      variableMinTotal: 0,
    },
  };
  if (!included) return totals;
  totals[key] = { count: 1, ...totalsForIncludedSeries(series) };
  return totals;
}

function emptySummaryTotals(): Omit<SummaryTotals, 'count'> {
  return {
    billMaxTotal: 0,
    billMinTotal: 0,
    fixedTotal: 0,
    monthlyMaxTotal: 0,
    monthlyMinTotal: 0,
    monthlyTotal: 0,
    subscriptionMaxTotal: 0,
    subscriptionMinTotal: 0,
    variableMaxTotal: 0,
    variableMinTotal: 0,
  };
}

async function getRecurringSeriesOrFail(req: AuthedRequest) {
  const {
    params: { recurringSeriesId },
  } = await zParse(recurringIdParamSchema, req);
  const recurringSeries = await DI.em.findOne(
    RecurringSeries,
    buildRecurringWhere(await resolveTenantKey(req), { recurringSeriesKey: recurringSeriesId }),
  );
  if (!recurringSeries) {
    throw new NotFoundError('Recurring payment not found');
  }
  return recurringSeries;
}

async function loadRecurringCategoryOrFail(req: AuthedRequest, categoryKey: number) {
  const tenantKey = await resolveTenantKey(req);
  const category = await findAssignableCategory(DI.em, tenantKey, categoryKey);
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  return category;
}

function mergeCurrencyTotals(a: Record<string, SummaryTotals>, b: Record<string, SummaryTotals>) {
  const merged = { ...a };
  for (const [key, value] of Object.entries(b)) {
    merged[key] = merged[key]
      ? {
          billMaxTotal: merged[key].billMaxTotal + value.billMaxTotal,
          billMinTotal: merged[key].billMinTotal + value.billMinTotal,
          count: merged[key].count + value.count,
          fixedTotal: merged[key].fixedTotal + value.fixedTotal,
          monthlyMaxTotal: merged[key].monthlyMaxTotal + value.monthlyMaxTotal,
          monthlyMinTotal: merged[key].monthlyMinTotal + value.monthlyMinTotal,
          monthlyTotal: merged[key].monthlyTotal + value.monthlyTotal,
          subscriptionMaxTotal: merged[key].subscriptionMaxTotal + value.subscriptionMaxTotal,
          subscriptionMinTotal: merged[key].subscriptionMinTotal + value.subscriptionMinTotal,
          variableMaxTotal: merged[key].variableMaxTotal + value.variableMaxTotal,
          variableMinTotal: merged[key].variableMinTotal + value.variableMinTotal,
        }
      : value;
  }
  return merged;
}

function monthlyAmount(
  series: Pick<
    RecurringSeries,
    'amountType' | 'averageAmount' | 'cadence' | 'expectedAmount' | 'expectedAmountMax' | 'expectedAmountMin'
  >,
  kind: 'fixed' | 'max' | 'min',
) {
  const amount =
    kind === 'fixed'
      ? (series.expectedAmount ?? series.averageAmount)
      : kind === 'max'
        ? (series.expectedAmountMax ?? series.expectedAmount ?? series.averageAmount)
        : (series.expectedAmountMin ?? series.expectedAmount ?? series.averageAmount);
  if (amount == null) return 0;
  switch (series.cadence) {
    case RecurringCadence.biweekly:
      return amount * (26 / 12);
    case RecurringCadence.monthly:
      return amount;
    case RecurringCadence.quarterly:
      return amount / 3;
    case RecurringCadence.weekly:
      return amount * (52 / 12);
    case RecurringCadence.yearly:
      return amount / 12;
    default:
      return amount;
  }
}

function recurringDto(series: RecurringSeries) {
  return {
    accountKey: series.accountKey ? { accountKey: series.accountKey.accountKey } : undefined,
    amountType: series.amountType,
    averageAmount: series.averageAmount,
    cadence: series.cadence,
    cadenceConfidence: series.cadenceConfidence,
    category: series.categoryKey
      ? {
          bgColor: series.categoryKey.bgColor,
          categoryKey: series.categoryKey.categoryKey,
          icon: series.categoryKey.icon,
          isSystemCategory: series.categoryKey.isSystemCategory,
          name: series.categoryKey.name,
          textColor: series.categoryKey.textColor,
        }
      : undefined,
    confidenceScore: series.confidenceScore,
    currency: series.currencyKey
      ? { code: series.currencyKey.code, currencyKey: series.currencyKey.currencyKey }
      : undefined,
    displayName: series.displayName,
    expectedAmount: series.expectedAmount,
    expectedAmountMax: series.expectedAmountMax,
    expectedAmountMin: series.expectedAmountMin,
    lastAmount: series.lastAmount,
    lastSeenAt: series.lastSeenAt,
    nextExpectedAt: series.nextExpectedAt,
    normalizedMerchantKey: series.normalizedMerchantKey,
    occurrenceCount: series.occurrenceCount,
    recurringSeriesKey: series.recurringSeriesKey,
    source: series.source,
    status: series.status,
    type: series.type,
  };
}

async function resolveTenantKey(req: AuthedRequest) {
  if (req.tenant?.tenantKey) return req.tenant.tenantKey;
  const appuserKey = req.appuser?.appuserKey ?? req.user?.appuserKey;
  if (!appuserKey) throw new BadRequestError('User context not found');
  const appuserTenant = await DI.em.findOne(
    AppuserTenant,
    { appuserKey: { appuserKey }, deletedAt: null, recordActive: true },
    { populate: ['tenantKey'] },
  );
  const tenantKey = appuserTenant?.tenantKey;
  if (!tenantKey) throw new NotFoundError('Tenant not found');
  return tenantKey.tenantKey;
}

function summaryFor(series: RecurringSeries) {
  const included =
    series.status === RecurringSeriesStatus.confirmed ||
    (series.status === RecurringSeriesStatus.candidate && series.confidenceScore >= 90);
  return {
    ...(included ? totalsForIncludedSeries(series) : emptySummaryTotals()),
    detectedIncludedCount: included ? 1 : 0,
    needsReviewCount: series.status === RecurringSeriesStatus.candidate && series.confidenceScore < 90 ? 1 : 0,
  };
}

function totalsForIncludedSeries(series: RecurringSeries): Omit<SummaryTotals, 'count'> {
  const fixed = series.amountType === RecurringAmountType.fixed ? monthlyAmount(series, 'fixed') : 0;
  const min = series.amountType === RecurringAmountType.variable ? monthlyAmount(series, 'min') : fixed;
  const max = series.amountType === RecurringAmountType.variable ? monthlyAmount(series, 'max') : fixed;
  const isSubscription = series.type === RecurringSeriesType.subscription;

  return {
    billMaxTotal: isSubscription ? 0 : max,
    billMinTotal: isSubscription ? 0 : min,
    fixedTotal: fixed,
    monthlyMaxTotal: max,
    monthlyMinTotal: min,
    monthlyTotal: max,
    subscriptionMaxTotal: isSubscription ? max : 0,
    subscriptionMinTotal: isSubscription ? min : 0,
    variableMaxTotal: series.amountType === RecurringAmountType.variable ? max : 0,
    variableMinTotal: series.amountType === RecurringAmountType.variable ? min : 0,
  };
}
