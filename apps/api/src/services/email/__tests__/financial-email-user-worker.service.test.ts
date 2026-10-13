import { describe, expect, it, vi } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';
import type { MonthlyStoryAggregationResult, MonthlyStoryFacts, MonthlyStoryInsufficientResult, WeeklyAggregationResult } from '@service/budget/aggregation-types';

const netWorthMocks = vi.hoisted(() => ({ getNetWorth: vi.fn(), getNetWorthHistory: vi.fn() }));
vi.mock('@service/net-worth/net-worth.service', () => ({
  NetWorthService: vi.fn().mockImplementation(function NetWorthService() { return netWorthMocks; }),
}));

import { combineMonthlyStoryResults, combineWeeklyResults, FinancialEmailUserWorkerService } from '../financial-email-user-worker.service';

type Dep<K extends keyof WorkerDeps> = NonNullable<WorkerDeps[K]>;
type WeeklyInput = Parameters<typeof combineWeeklyResults>[0][number];
type WorkerDeps = NonNullable<ConstructorParameters<typeof FinancialEmailUserWorkerService>[0]>;

const range = { end: new Date('2026-07-13T00:00:00Z'), start: new Date('2026-07-06T00:00:00Z') };
const weekly = (tenantKey: number, overrides: Partial<WeeklyAggregationResult['facts']> = {}): WeeklyAggregationResult => ({
  appuserKey: 7,
  diagnostics: { ambiguousCategoryAssignments: 0, duplicateTransactionRows: 0, excludedTransfers: 0, invalidAccounts: 0, invalidLoanLinks: 0, invalidTransactionDates: 0, missingConvertedAmounts: 0, uncategorizedTransactions: 0 },
  facts: { activeBudgetStatus: 'within_plan', categoryTotals: [{ amount: '10', categoryKey: tenantKey, displayName: `Category ${tenantKey}` }], comparisonPercentage: '0', comparisonWeekTotal: '5', isoWeek: 28, isoWeekYear: 2026, subjectWeekTotal: '10', topCategory: { amount: '10', categoryKey: tenantKey, displayName: `Category ${tenantKey}` }, ...overrides },
  period: { comparisonWeek: range, isoWeek: 28, isoWeekYear: 2026, month: 7, monthRange: range, scheduledFor: new Date('2026-07-13T08:00:00Z'), subjectWeek: range, year: 2026 },
  status: 'ok',
  suppressedBudgets: [],
  tenantKey,
  weeklyComponents: { activeBudgetStatus: overrides.activeBudgetStatus ?? 'within_plan', categoryTotals: overrides.categoryTotals ?? [{ amount: '10', categoryKey: tenantKey, displayName: `Category ${tenantKey}` }], comparisonSignedTotal: overrides.comparisonWeekTotal === null ? null : (overrides.comparisonWeekTotal ?? '5'), hasSubjectTransactions: true, subjectSignedTotal: overrides.subjectWeekTotal ?? '10' },
});

describe('financial email per-user fan-in', () => {
  it.each([
    ['budget', 'stale_budget_job', '2026-07-17T08:59:59Z'],
    ['weekly', 'stale_weekly_job', '2026-07-15T08:59:59Z'],
    ['budget', 'future_scheduled_job', '2026-07-18T09:05:01Z'],
  ] as const)('suppresses stale %s jobs before eligibility or aggregation', async (stream, reason, scheduledFor) => {
    const preferences = { getFreshWorkerEligibility: vi.fn() };
    const service = new FinancialEmailUserWorkerService({ em: {} as unknown as Dep<'em'>, now: () => new Date('2026-07-18T09:00:00Z'), preferences: preferences as unknown as Dep<'preferences'> });
    await expect(service.process({ appuserKey: 7, scheduledFor, stream })).resolves.toMatchObject({ reason, result: 'suppressed' });
    expect(preferences.getFreshWorkerEligibility).not.toHaveBeenCalled();
  });
  it('combines global category totals, comparison and budget severity deterministically', () => {
    const combined = combineWeeklyResults([
      weekly(1, { activeBudgetStatus: 'near', categoryTotals: [{ amount: '20', categoryKey: 5, displayName: 'Shared' }] }),
      weekly(2, { activeBudgetStatus: 'over', categoryTotals: [{ amount: '20', categoryKey: 4, displayName: 'Winner' }] }),
    ]);
    expect(combined).toMatchObject({ facts: { activeBudgetStatus: 'over', comparisonWeekTotal: '10', subjectWeekTotal: '20', topCategory: { categoryKey: 4, displayName: 'Winner' } }, status: 'ok' });
  });

  it('omits comparison unless every successful tenant is comparable and rejects period mismatch', () => {
    expect(combineWeeklyResults([weekly(1), weekly(2, { comparisonWeekTotal: null })])).toMatchObject({ facts: { comparisonPercentage: null, comparisonWeekTotal: null }, status: 'ok' });
    const mismatched = weekly(2);
    mismatched.period.isoWeek = 29;
    expect(combineWeeklyResults([weekly(1), mismatched])).toEqual({ reason: 'period_mismatch', status: 'suppressed' });
  });

  it('combines signed cross-tenant refunds before global floor and includes no-subject budget severity', () => {
    const expense = weekly(1);
    expense.weeklyComponents = { activeBudgetStatus: 'within_plan', categoryTotals: [{ amount: '100', categoryKey: 5, displayName: 'Shared' }], comparisonSignedTotal: '40', hasSubjectTransactions: true, subjectSignedTotal: '100' };
    const refund = weekly(2);
    refund.weeklyComponents = { activeBudgetStatus: 'over', categoryTotals: [{ amount: '-40', categoryKey: 5, displayName: 'Shared' }], comparisonSignedTotal: '10', hasSubjectTransactions: false, subjectSignedTotal: '-40' };
    expect(combineWeeklyResults([expense, refund])).toMatchObject({ facts: { activeBudgetStatus: 'over', comparisonWeekTotal: '50', subjectWeekTotal: '60', topCategory: { amount: '60', categoryKey: 5 } }, status: 'ok' });
    refund.weeklyComponents.subjectSignedTotal = '-200';
    refund.weeklyComponents.categoryTotals = [{ amount: '-200', categoryKey: 5, displayName: 'Shared' }];
    expect(combineWeeklyResults([expense, refund])).toEqual({ reason: 'no_useful_sections', status: 'suppressed' });
  });

  it('distinguishes missing tenant components from no useful global content', () => {
    const { weeklyComponents: _weeklyComponents, ...missing } = weekly(2);
    expect(combineWeeklyResults([weekly(1), missing as unknown as WeeklyInput], 2)).toEqual({ reason: 'no_facts', status: 'suppressed' });
    expect(combineWeeklyResults([], 2)).toEqual({ reason: 'no_facts', status: 'suppressed' });
  });

  it('deduplicates memberships and dry-run renders without delivery orchestration', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ tenantKey: 1 }, { tenantKey: 1 }, { tenantKey: 2 }]).mockResolvedValueOnce([{ tenantKey: 1 }, { tenantKey: 2 }]);
    const aggregation = { aggregateBudgetThresholds: vi.fn().mockImplementation(({ tenantKey }) => Promise.resolve(tenantKey === 1 ? { appuserKey: 7, diagnostics: {}, facts: [{ actualPercentage: '80', amountBudgeted: '100', amountSpent: '80', budgetKey: 1, budgetName: 'B', budgetTemplateCategoryKey: 2, categoryKey: 3, categoryName: 'C', claimThresholds: [80], currencyCode: 'EUR', month: 7, parentCategoryName: 'P', remainingOrOverAmount: '20', state: 'near', threshold: 80, year: 2026 }], period: { day: range, localDate: '2026-07-18', month: 7, monthRange: range, scheduledFor: new Date('2026-07-18T08:00:00Z'), year: 2026 }, status: 'ok', suppressedBudgets: [], tenantKey } : { facts: [], reason: 'no_facts', status: 'suppressed' })) };
    const rendering = { renderBudget: vi.fn().mockResolvedValue({}) };
    const orchestration = { deliverBudget: vi.fn() };
    const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValue({ currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: true, emailAddress: 'user@example.com', firstName: 'User' }) };
    const reservations = { inspectBudgetClaims: vi.fn().mockResolvedValue({ newCrossingKeys: ['ba:c:1:1:2:202607:80'], reason: 'new_claims' }) };
    const service = new FinancialEmailUserWorkerService({ aggregation: aggregation as unknown as Dep<'aggregation'>, em: { count: vi.fn().mockResolvedValue(1), getConnection: () => ({ execute }) } as unknown as Dep<'em'>, now: () => new Date('2026-07-18T09:00:00Z'), orchestration: orchestration as unknown as Dep<'orchestration'>, preferences: preferences as unknown as Dep<'preferences'>, rendering: rendering as unknown as Dep<'rendering'>, reservations: reservations as unknown as Dep<'reservations'> });
    await expect(service.process({ appuserKey: 7, dryRun: true, scheduledFor: '2026-07-18T08:00:00Z', stream: 'budget' })).resolves.toMatchObject({ reason: 'renderable', result: 'dry_run' });
    expect(aggregation.aggregateBudgetThresholds).toHaveBeenCalledTimes(2);
    expect(rendering.renderBudget).toHaveBeenCalledOnce();
    expect(orchestration.deliverBudget).not.toHaveBeenCalled();
  });

  it('suppresses when consent changes during aggregation before reservation', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ tenantKey: 1 }]);
    const aggregation = { aggregateBudgetThresholds: vi.fn().mockResolvedValue({ appuserKey: 7, diagnostics: {}, facts: [{ actualPercentage: '80', amountBudgeted: '100', amountSpent: '80', budgetKey: 1, budgetName: 'B', budgetTemplateCategoryKey: 2, categoryKey: 3, categoryName: 'C', claimThresholds: [80], currencyCode: 'EUR', month: 7, parentCategoryName: 'P', remainingOrOverAmount: '20', state: 'near', threshold: 80, year: 2026 }], period: { day: range, localDate: '2026-07-18', month: 7, monthRange: range, scheduledFor: new Date('2026-07-18T08:00:00Z'), year: 2026 }, status: 'ok', suppressedBudgets: [], tenantKey: 1 }) };
    const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValueOnce({ currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: true, emailAddress: 'old@example.com', firstName: null }).mockResolvedValueOnce({ currencyCode: 'EUR', deliverySupported: false, effectiveEnabled: false, emailAddress: 'changed@example.com', firstName: null }) };
    const orchestration = { deliverBudget: vi.fn() };
    const service = new FinancialEmailUserWorkerService({ aggregation: aggregation as unknown as Dep<'aggregation'>, em: { count: vi.fn().mockResolvedValue(1), getConnection: () => ({ execute }) } as unknown as Dep<'em'>, now: () => new Date('2026-07-18T09:00:00Z'), orchestration: orchestration as unknown as Dep<'orchestration'>, preferences: preferences as unknown as Dep<'preferences'> });
    await expect(service.process({ appuserKey: 7, scheduledFor: '2026-07-18T08:00:00Z', stream: 'budget' })).resolves.toMatchObject({ reason: 'eligibility_changed', result: 'suppressed' });
    expect(orchestration.deliverBudget).not.toHaveBeenCalled();
  });

  it('suppresses when an active tenant deactivates during aggregation', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ tenantKey: 1 }]).mockResolvedValueOnce([]);
    const aggregation = { aggregateBudgetThresholds: vi.fn().mockResolvedValue({ appuserKey: 7, diagnostics: {}, facts: [{ actualPercentage: '80', amountBudgeted: '100', amountSpent: '80', budgetKey: 1, budgetName: 'B', budgetTemplateCategoryKey: 2, categoryKey: 3, categoryName: 'C', claimThresholds: [80], currencyCode: 'EUR', month: 7, parentCategoryName: 'P', remainingOrOverAmount: '20', state: 'near', threshold: 80, year: 2026 }], period: { day: range, localDate: '2026-07-18', month: 7, monthRange: range, scheduledFor: new Date('2026-07-18T08:00:00Z'), year: 2026 }, status: 'ok', suppressedBudgets: [], tenantKey: 1 }) };
    const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValue({ currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: true, emailAddress: 'user@example.com', firstName: null }) };
    const orchestration = { deliverBudget: vi.fn() };
    const service = new FinancialEmailUserWorkerService({ aggregation: aggregation as unknown as Dep<'aggregation'>, em: { count: vi.fn().mockResolvedValue(1), getConnection: () => ({ execute }) } as unknown as Dep<'em'>, now: () => new Date('2026-07-18T09:00:00Z'), orchestration: orchestration as unknown as Dep<'orchestration'>, preferences: preferences as unknown as Dep<'preferences'> });
    await expect(service.process({ appuserKey: 7, scheduledFor: '2026-07-18T08:00:00Z', stream: 'budget' })).resolves.toMatchObject({ reason: 'eligibility_changed', result: 'suppressed' });
    expect(orchestration.deliverBudget).not.toHaveBeenCalled();
  });

  describe('monthlyStory', () => {
    const monthlyPeriod = { day: range, localDate: '2026-08-01', month: 8, monthRange: range, scheduledFor: new Date('2026-08-01T09:00:00Z'), year: 2026 };
    const diagnostics = { ambiguousCategoryAssignments: 0, duplicateTransactionRows: 0, excludedTransfers: 0, invalidAccounts: 0, invalidLoanLinks: 0, invalidTransactionDates: 0, missingConvertedAmounts: 0, uncategorizedTransactions: 0 };
    const monthlyFacts: MonthlyStoryFacts = {
      budgetPressure: 'within_plan',
      categoryDeltas: [{ baselineAmount: '50', categoryKey: 9, direction: 'decrease', displayName: 'Groceries', percentOfBaseline: '-10.00', subjectAmount: '45' }],
      incomeBaseline: '1000',
      incomeSubject: '1100',
      recurringChanges: [],
      savingsRateBaseline: '10.00',
      savingsRateSubject: '15.00',
      spendingBaseline: '800',
      spendingSubject: '750',
    };

    it('processes a sufficient-data monthlyStory result end to end', async () => {
      netWorthMocks.getNetWorth.mockResolvedValue({ totalNetWorth: 1500 });
      netWorthMocks.getNetWorthHistory.mockResolvedValue({ points: [{ isComplete: true, totalNetWorth: 1000 }, { isComplete: true, totalNetWorth: 1500 }] });
      const execute = vi.fn().mockResolvedValueOnce([{ tenantKey: 1 }]).mockResolvedValueOnce([{ tenantKey: 1 }]);
      const aggregation = { aggregateMonthlyStory: vi.fn().mockResolvedValue({ appuserKey: 7, diagnostics, facts: monthlyFacts, period: monthlyPeriod, status: 'ok', tenantKey: 1 } satisfies MonthlyStoryAggregationResult) };
      const rendering = { renderMonthlyStory: vi.fn().mockResolvedValue({ headers: {}, html: '<html/>', subject: 'Your August story', text: 'text' }) };
      const orchestration = { deliverMonthlyStory: vi.fn().mockImplementation(async (input: { render: () => Promise<unknown> }) => { await input.render(); return { result: 'accepted' }; }) };
      const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValue({ currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: true, emailAddress: 'user@example.com', firstName: 'User', language: SupportedLanguages.EN }) };
      const narrative = { generate: vi.fn().mockResolvedValue({ sentences: ['You spent less than usual this month.'], source: 'skeleton' }) };
      const em = { count: vi.fn().mockResolvedValue(1), find: vi.fn().mockResolvedValue([]), findOneOrFail: vi.fn().mockResolvedValue({ appuserKey: 7 }), getConnection: () => ({ execute }) };
      const service = new FinancialEmailUserWorkerService({ aggregation: aggregation as unknown as Dep<'aggregation'>, em: em as unknown as Dep<'em'>, narrative: narrative as unknown as Dep<'narrative'>, now: () => new Date('2026-08-01T09:00:00Z'), orchestration: orchestration as unknown as Dep<'orchestration'>, preferences: preferences as unknown as Dep<'preferences'>, rendering: rendering as unknown as Dep<'rendering'> });

      const outcome = await service.process({ appuserKey: 7, scheduledFor: '2026-08-01T09:00:00Z', stream: 'monthlyStory' });

      expect(outcome).toMatchObject({ counts: { memberships: 1 }, result: 'accepted' });
      expect(em.findOneOrFail).toHaveBeenCalledWith(expect.anything(), { appuserKey: 7 });
      expect(narrative.generate).toHaveBeenCalledWith(expect.objectContaining({ ...monthlyFacts, recurringChanges: [] }), { baseline: '1000', subject: '1500' }, 'August 2026', 'en');
      expect(rendering.renderMonthlyStory).toHaveBeenCalledWith(expect.objectContaining({
        currencyCode: 'EUR',
        monthLabel: 'August 2026',
        narrativeSentences: ['You spent less than usual this month.'],
        netWorth: { subject: '1500', tone: 'positive' },
      }));
    });

    it('routes to the low-data path when aggregateMonthlyStory reports insufficient_data', async () => {
      const execute = vi.fn().mockResolvedValueOnce([{ tenantKey: 1 }]).mockResolvedValueOnce([{ tenantKey: 1 }]);
      const aggregation = { aggregateMonthlyStory: vi.fn().mockResolvedValue({ appuserKey: 7, monthsAvailable: 1, monthsNeeded: 3, period: monthlyPeriod, reason: 'insufficient_history', status: 'insufficient_data', tenantKey: 1 } satisfies MonthlyStoryInsufficientResult) };
      const rendering = { renderMonthlyStory: vi.fn(), renderMonthlyStoryInsufficient: vi.fn().mockResolvedValue({ headers: {}, html: '<html/>', subject: 'Almost there', text: 'text' }) };
      const orchestration = { deliverMonthlyStory: vi.fn().mockImplementation(async (input: { render: () => Promise<unknown> }) => { await input.render(); return { result: 'accepted' }; }) };
      const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValue({ currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: true, emailAddress: 'user@example.com', firstName: 'User', language: SupportedLanguages.EN }) };
      const narrative = { generate: vi.fn() };
      const em = { count: vi.fn().mockResolvedValue(1), find: vi.fn(), findOneOrFail: vi.fn(), getConnection: () => ({ execute }) };
      const service = new FinancialEmailUserWorkerService({ aggregation: aggregation as unknown as Dep<'aggregation'>, em: em as unknown as Dep<'em'>, narrative: narrative as unknown as Dep<'narrative'>, now: () => new Date('2026-08-01T09:00:00Z'), orchestration: orchestration as unknown as Dep<'orchestration'>, preferences: preferences as unknown as Dep<'preferences'>, rendering: rendering as unknown as Dep<'rendering'> });

      const outcome = await service.process({ appuserKey: 7, scheduledFor: '2026-08-01T09:00:00Z', stream: 'monthlyStory' });

      expect(outcome).toMatchObject({ result: 'accepted' });
      expect(rendering.renderMonthlyStoryInsufficient).toHaveBeenCalledWith(expect.objectContaining({ monthsAvailable: 1, monthsNeeded: 3, reason: 'insufficient_history' }));
      expect(rendering.renderMonthlyStory).not.toHaveBeenCalled();
      expect(narrative.generate).not.toHaveBeenCalled();
      expect(em.findOneOrFail).not.toHaveBeenCalled();
    });

    it('combines tenant results by preferring the first ok result, falling back to insufficient_data, and rejecting an empty list', () => {
      const ok = { appuserKey: 7, diagnostics, facts: monthlyFacts, period: monthlyPeriod, status: 'ok', tenantKey: 1 } satisfies MonthlyStoryAggregationResult;
      const insufficient = { appuserKey: 7, monthsAvailable: 1, monthsNeeded: 3, period: monthlyPeriod, reason: 'insufficient_history', status: 'insufficient_data', tenantKey: 2 } satisfies MonthlyStoryInsufficientResult;
      expect(combineMonthlyStoryResults([insufficient, ok])).toBe(ok);
      expect(combineMonthlyStoryResults([insufficient])).toBe(insufficient);
      expect(() => combineMonthlyStoryResults([])).toThrow('combineMonthlyStoryResults requires at least one tenant result');
    });
  });
});
