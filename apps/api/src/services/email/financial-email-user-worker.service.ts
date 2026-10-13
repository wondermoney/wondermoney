import type { EntityManager } from '@mikro-orm/postgresql';
import Big from 'big.js';

import { DI } from '@app/database/di';
import { BUDGET_EMAIL_MAX_AGE_SECONDS, MONTHLY_STORY_EMAIL_MAX_AGE_SECONDS, WEEKLY_EMAIL_MAX_AGE_SECONDS } from '@app/jobs/financial-emails.queue';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import type { LisbonWeeklyPeriod } from '@service/budget/aggregation-periods';
import type { AggregationSuppressedResult, BudgetAggregationResult, MonthlyStoryAggregationResult, MonthlyStoryFacts, MonthlyStoryInsufficientResult, WeeklyAggregationResult, WeeklyInsightFacts } from '@service/budget/aggregation-types';
import type { NarrativeLanguage, NetWorthDriverInput } from '@service/budget/monthly-story-narrative-skeleton';
import { MonthlyStoryNarrativeService } from '@service/budget/monthly-story-narrative.service';
import { computeMonthlyRecurringChanges } from '@service/budget/monthly-story-recurring-changes';
import { TenantFinancialAggregationService } from '@service/budget/tenant-financial-aggregation.service';
import type { RenderedEmailInput } from '@service/email/email';
import { EmailNotificationPreferenceService } from '@service/email/email-notification-preference.service';
import { FinancialEmailReservationService } from '@service/email/financial-email-delivery.service';
import { FinancialEmailOrchestrationService } from '@service/email/financial-email-orchestration.service';
import { FinancialEmailRenderingService } from '@service/email/financial-email-rendering.service';
import { NetWorthService } from '@service/net-worth/net-worth.service';

type FinancialEmailStream = 'budget' | 'monthlyStory' | 'weekly';

const PREFERENCE_STREAM_BY_INPUT_STREAM = { budget: 'budgetAlerts', monthlyStory: 'monthlyStory', weekly: 'weeklyInsights' } as const;
const MAX_AGE_SECONDS_BY_STREAM = { budget: BUDGET_EMAIL_MAX_AGE_SECONDS, monthlyStory: MONTHLY_STORY_EMAIL_MAX_AGE_SECONDS, weekly: WEEKLY_EMAIL_MAX_AGE_SECONDS } as const;
const STALE_REASON_BY_STREAM = { budget: 'stale_budget_job', monthlyStory: 'stale_monthly_story_job', weekly: 'stale_weekly_job' } as const;

export class FinancialEmailUserWorkerService {
  private readonly aggregation: TenantFinancialAggregationService;
  private readonly em: EntityManager;
  private readonly narrative: MonthlyStoryNarrativeService;
  private readonly now: () => Date;
  private readonly orchestration: FinancialEmailOrchestrationService;
  private readonly preferences: EmailNotificationPreferenceService;
  private readonly rendering: FinancialEmailRenderingService;
  private readonly reservations: FinancialEmailReservationService;

  constructor(deps: { aggregation?: TenantFinancialAggregationService; em?: EntityManager; narrative?: MonthlyStoryNarrativeService; now?: () => Date; orchestration?: FinancialEmailOrchestrationService; preferences?: EmailNotificationPreferenceService; rendering?: FinancialEmailRenderingService; reservations?: FinancialEmailReservationService } = {}) {
    this.em = deps.em ?? DI.em;
    this.aggregation = deps.aggregation ?? new TenantFinancialAggregationService();
    this.narrative = deps.narrative ?? new MonthlyStoryNarrativeService();
    this.preferences = deps.preferences ?? new EmailNotificationPreferenceService(this.em);
    this.rendering = deps.rendering ?? new FinancialEmailRenderingService();
    this.reservations = deps.reservations ?? new FinancialEmailReservationService(this.em);
    this.now = deps.now ?? (() => new Date());
    const adapter = async (rendered: RenderedEmailInput) => (await import('@service/email/email')).sendRenderedEmail(rendered);
    this.orchestration = deps.orchestration ?? new FinancialEmailOrchestrationService(new FinancialEmailReservationService(this.em), this.rendering, adapter);
  }

  async process(input: { appuserKey: number; dryRun?: boolean; scheduledFor: string; stream: FinancialEmailStream }) {
    const scheduledAt = new Date(input.scheduledFor);
    const maxAge = MAX_AGE_SECONDS_BY_STREAM[input.stream] * 1000;
    if (!Number.isFinite(scheduledAt.getTime())) return result('suppressed', 'invalid_scheduled_for');
    if (scheduledAt.getTime() - this.now().getTime() > 5 * 60 * 1000) return result('suppressed', 'future_scheduled_job');
    if (this.now().getTime() - scheduledAt.getTime() > maxAge) return result('suppressed', STALE_REASON_BY_STREAM[input.stream]);
    const preference = await this.preferences.getFreshWorkerEligibility(input.appuserKey, PREFERENCE_STREAM_BY_INPUT_STREAM[input.stream]);
    if (!preference?.effectiveEnabled) return result('suppressed', preference ? 'preference_disabled' : 'user_unavailable');
    const tenantKeys = await this.loadTenantKeys(input.appuserKey);
    if (!tenantKeys.length) return result('suppressed', 'no_active_memberships');

    if (input.stream === 'budget') {
      const tenantResults = await Promise.all(tenantKeys.map((tenantKey) => this.aggregation.aggregateBudgetThresholds({ appuserKey: input.appuserKey, scheduledFor: input.scheduledFor, tenantKey })));
      const successfulBudget = tenantResults.filter((tenant): tenant is BudgetAggregationResult => tenant.status === 'ok');
      if (!budgetPeriodsAgree(successfulBudget)) return result('suppressed', 'period_mismatch', { memberships: tenantKeys.length, successfulTenants: successfulBudget.length });
      const facts = tenantResults.flatMap((tenant) => tenant.status === 'ok' ? tenant.facts.map((fact) => ({ ...fact, tenantKey: tenant.tenantKey })) : []);
      facts.sort((a, b) => a.tenantKey - b.tenantKey || a.budgetKey - b.budgetKey || a.budgetTemplateCategoryKey - b.budgetTemplateCategoryKey || a.threshold - b.threshold);
      if (!facts.length) return result('suppressed', 'no_facts', { memberships: tenantKeys.length, successfulTenants: 0 });
      const firstSuccess = tenantResults.find((tenant): tenant is BudgetAggregationResult => tenant.status === 'ok');
      if (!firstSuccess) return result('suppressed', 'no_facts');
      const localDate = firstSuccess.period.localDate;
      if (input.dryRun) {
        const fresh = await this.revalidate(input.appuserKey, 'budget', tenantKeys);
        if (!fresh) return result('suppressed', 'eligibility_changed');
        const crossings = facts.flatMap((fact) => fact.claimThresholds.map((threshold) => ({ budgetKey: fact.budgetKey, budgetTemplateCategoryKey: fact.budgetTemplateCategoryKey, month: fact.month, tenantKey: fact.tenantKey, threshold, year: fact.year })));
        const plan = await this.reservations.inspectBudgetClaims(input.appuserKey, crossings);
        if (plan.reason !== 'new_claims') return result('dry_run', plan.reason, { facts: 0, memberships: tenantKeys.length });
        const keys = new Set(plan.newCrossingKeys);
        const filtered = facts.filter((fact) => fact.claimThresholds.some((threshold) => keys.has(`ba:c:${fact.tenantKey}:${fact.budgetKey}:${fact.budgetTemplateCategoryKey}:${fact.year}${String(fact.month).padStart(2, '0')}:${threshold}`)));
        await this.rendering.renderBudget({ appuserKey: input.appuserKey, facts: filtered, firstName: fresh.firstName ?? undefined, language: fresh.language, recipient: fresh.emailAddress });
        return result('dry_run', 'renderable', { facts: filtered.length, memberships: tenantKeys.length });
      }
      const fresh = await this.revalidate(input.appuserKey, 'budget', tenantKeys);
      if (!fresh) return result('suppressed', 'eligibility_changed');
      const delivered = await this.orchestration.deliverBudget({ appuserKey: input.appuserKey, deliverySupported: fresh.deliverySupported, effectivelyEnabled: fresh.effectiveEnabled, facts, firstName: fresh.firstName ?? undefined, language: fresh.language, localDate, recipient: fresh.emailAddress });
      return { ...delivered, counts: { facts: facts.length, memberships: tenantKeys.length } };
    }

    if (input.stream === 'monthlyStory') {
      const tenantResults = await Promise.all(tenantKeys.map((tenantKey) => this.aggregation.aggregateMonthlyStory({ appuserKey: input.appuserKey, scheduledFor: input.scheduledFor, tenantKey })));
      const combined = combineMonthlyStoryResults(tenantResults);
      const fresh = await this.revalidate(input.appuserKey, 'monthlyStory', tenantKeys);
      if (!fresh) return result('suppressed', 'eligibility_changed');

      if (combined.status === 'insufficient_data') {
        const delivered = await this.orchestration.deliverMonthlyStory({
          appuserKey: input.appuserKey,
          deliverySupported: fresh.deliverySupported,
          effectivelyEnabled: fresh.effectiveEnabled,
          firstName: fresh.firstName ?? undefined,
          language: fresh.language,
          month: combined.period.month,
          recipient: fresh.emailAddress,
          render: () => this.rendering.renderMonthlyStoryInsufficient({ appuserKey: input.appuserKey, firstName: fresh.firstName ?? undefined, language: fresh.language, monthLabel: monthLabelFor(combined.period, fresh.language), monthsAvailable: combined.monthsAvailable, monthsNeeded: combined.monthsNeeded, reason: combined.reason, recipient: fresh.emailAddress }),
          year: combined.period.year,
        });
        return { ...delivered, counts: { memberships: tenantKeys.length } };
      }

      const netWorthService = new NetWorthService();
      const appuser = await this.em.findOneOrFail(Appuser, { appuserKey: input.appuserKey });
      const [netWorth, netWorthHistory] = await Promise.all([netWorthService.getNetWorth(appuser), netWorthService.getNetWorthHistory(appuser, { months: 2 })]);
      const completePoints = netWorthHistory.points.filter((point) => point.isComplete && point.totalNetWorth != null);
      const previousPoint = completePoints.at(-2);
      const netWorthInput: NetWorthDriverInput | null = previousPoint?.totalNetWorth != null ? { baseline: String(previousPoint.totalNetWorth), subject: String(netWorth.totalNetWorth) } : null;

      const recurringChanges = (await Promise.all(tenantKeys.map((tenantKey) => computeMonthlyRecurringChanges(this.em, tenantKey, combined.period.monthRange)))).flat();
      const factsWithRecurring: MonthlyStoryFacts = { ...combined.facts, recurringChanges };
      const monthLabel = monthLabelFor(combined.period, fresh.language);
      const narrativeLanguage: NarrativeLanguage = fresh.language === SupportedLanguages.PT ? 'pt' : 'en';
      const narrative = await this.narrative.generate(factsWithRecurring, netWorthInput, monthLabel, narrativeLanguage);

      const delivered = await this.orchestration.deliverMonthlyStory({
        appuserKey: input.appuserKey,
        deliverySupported: fresh.deliverySupported,
        effectivelyEnabled: fresh.effectiveEnabled,
        firstName: fresh.firstName ?? undefined,
        language: fresh.language,
        month: combined.period.month,
        recipient: fresh.emailAddress,
        render: () => this.rendering.renderMonthlyStory({ appuserKey: input.appuserKey, currencyCode: fresh.currencyCode, facts: factsWithRecurring, firstName: fresh.firstName ?? undefined, language: fresh.language, monthLabel, narrativeSentences: narrative.sentences, netWorth: netWorthInput ? { subject: netWorthInput.subject, tone: Number(netWorthInput.subject) >= Number(netWorthInput.baseline) ? 'positive' : 'negative' } : null, recipient: fresh.emailAddress }),
        year: combined.period.year,
      });
      return { ...delivered, counts: { memberships: tenantKeys.length } };
    }

    const tenantResults = await Promise.all(tenantKeys.map((tenantKey) => this.aggregation.aggregateWeeklyInsights({ appuserKey: input.appuserKey, scheduledFor: input.scheduledFor, tenantKey })));
    const successful = tenantResults.filter((tenant): tenant is WeeklyAggregationResult => tenant.status === 'ok');
    const combined = combineWeeklyResults(tenantResults.filter((tenant) => tenant.status === 'ok' || tenant.weeklyComponents), tenantKeys.length);
    if (combined.status === 'suppressed') return result('suppressed', combined.reason, { memberships: tenantKeys.length, successfulTenants: successful.length });
    if (input.dryRun) {
      const fresh = await this.revalidate(input.appuserKey, 'weekly', tenantKeys);
      if (!fresh) return result('suppressed', 'eligibility_changed');
      const plan = await this.reservations.inspectWeeklyEnvelope(input.appuserKey, combined.facts.isoWeekYear, combined.facts.isoWeek);
      if (plan.reason === 'already_claimed') return result('dry_run', 'already_claimed', { memberships: tenantKeys.length, successfulTenants: successful.length });
      await this.rendering.renderWeekly({ appuserKey: input.appuserKey, currencyCode: fresh.currencyCode, facts: combined.facts, firstName: fresh.firstName ?? undefined, language: fresh.language, recipient: fresh.emailAddress, subjectWeek: combined.subjectWeek });
      return result('dry_run', 'renderable', { memberships: tenantKeys.length, successfulTenants: successful.length });
    }
    const fresh = await this.revalidate(input.appuserKey, 'weekly', tenantKeys);
    if (!fresh) return result('suppressed', 'eligibility_changed');
    const delivered = await this.orchestration.deliverWeekly({ appuserKey: input.appuserKey, currencyCode: fresh.currencyCode, deliverySupported: fresh.deliverySupported, effectivelyEnabled: fresh.effectiveEnabled, facts: combined.facts, firstName: fresh.firstName ?? undefined, isoWeek: combined.facts.isoWeek, isoWeekYear: combined.facts.isoWeekYear, language: fresh.language, recipient: fresh.emailAddress, subjectWeek: combined.subjectWeek });
    return { ...delivered, counts: { memberships: tenantKeys.length, successfulTenants: successful.length } };
  }

  private async loadTenantKeys(appuserKey: number) {
    const rows = await this.em.getConnection().execute<{ tenantKey: number }[]>(
      `select distinct membership."tenant_key" as "tenantKey" from "appuser_tenant" membership
       join "tenant" tenant on tenant."tenant_key" = membership."tenant_key"
       where membership."appuser_key" = ? and membership."record_active" = true and membership."deleted_at" is null
         and tenant."record_active" = true and tenant."deleted_at" is null order by membership."tenant_key"`,
      [appuserKey],
    );
    return [...new Set(rows.map((row) => row.tenantKey))];
  }

  private async revalidate(appuserKey: number, stream: FinancialEmailStream, originalTenantKeys: number[]) {
    const preference = await this.preferences.getFreshWorkerEligibility(appuserKey, PREFERENCE_STREAM_BY_INPUT_STREAM[stream]);
    if (!preference?.effectiveEnabled) return null;
    const currentTenantKeys = await this.loadTenantKeys(appuserKey);
    return currentTenantKeys.length === originalTenantKeys.length && currentTenantKeys.every((key, index) => key === originalTenantKeys[index]) ? preference : null;
  }
}

/**
 * Callers only ever invoke this with one result per tenant membership, and
 * `FinancialEmailUserWorkerService.process()` already guards `tenantKeys.length === 0`
 * before reaching this branch, so `results` is never empty in practice — the explicit
 * throw makes that invariant checkable rather than silently fabricating a malformed
 * fallback result if it's ever violated.
 */
export function combineMonthlyStoryResults(results: (MonthlyStoryAggregationResult | MonthlyStoryInsufficientResult)[]): MonthlyStoryAggregationResult | MonthlyStoryInsufficientResult {
  const first = results[0];
  if (!first) throw new Error('combineMonthlyStoryResults requires at least one tenant result');
  const ok = results.find((r): r is MonthlyStoryAggregationResult => r.status === 'ok');
  if (ok) return ok;
  const insufficient = results.find((r): r is MonthlyStoryInsufficientResult => r.status === 'insufficient_data');
  return insufficient ?? first;
}

export function combineWeeklyResults(results: (AggregationSuppressedResult | WeeklyAggregationResult)[], expectedMemberships = results.length) {
  const first = results[0];
  if (!first) return { reason: 'no_facts', status: 'suppressed' } as const;
  const firstPeriod = weeklyPeriod(first.period);
  if (!firstPeriod) return { reason: 'period_mismatch', status: 'suppressed' } as const;
  if (results.some((result) => {
    const period = weeklyPeriod(result.period);
    return period?.isoWeek !== firstPeriod.isoWeek || period.isoWeekYear !== firstPeriod.isoWeekYear || period.subjectWeek.start.getTime() !== firstPeriod.subjectWeek.start.getTime() || period.subjectWeek.end.getTime() !== firstPeriod.subjectWeek.end.getTime();
  })) return { reason: 'period_mismatch', status: 'suppressed' } as const;
  const components = results.map((tenant) => tenant.weeklyComponents).filter((value) => value != null);
  if (components.length !== expectedMemberships) return { reason: 'no_facts', status: 'suppressed' } as const;
  const subjectSignedTotal = components.reduce((sum, component) => sum.plus(component.subjectSignedTotal), new Big(0));
  const subjectTotal = subjectSignedTotal.lt(0) ? new Big(0) : subjectSignedTotal;
  const comparable = components.length === expectedMemberships && components.every((component) => component.comparisonSignedTotal != null);
  const comparisonTotal = comparable ? components.reduce((sum, component) => sum.plus(component.comparisonSignedTotal ?? 0), new Big(0)) : null;
  const categories = new Map<number, { amount: Big; categoryKey: number; displayName: string }>();
  for (const component of components) for (const category of component.categoryTotals) {
    const current = categories.get(category.categoryKey);
    categories.set(category.categoryKey, { amount: (current?.amount ?? new Big(0)).plus(category.amount), categoryKey: category.categoryKey, displayName: category.displayName });
  }
  const top = [...categories.values()].map((category) => ({ ...category, amount: category.amount.lt(0) ? new Big(0) : category.amount })).sort((a, b) => b.amount.cmp(a.amount) || a.categoryKey - b.categoryKey)[0];
  if (!top || (subjectTotal.eq(0) && top.amount.eq(0))) return { reason: 'no_useful_sections', status: 'suppressed' } as const;
  const severity = components.some((component) => component.activeBudgetStatus === 'over') ? 'over' : components.some((component) => component.activeBudgetStatus === 'near') ? 'near' : components.some((component) => component.activeBudgetStatus === 'within_plan') ? 'within_plan' : null;
  const facts: WeeklyInsightFacts = {
    activeBudgetStatus: severity,
    comparisonPercentage: comparisonTotal?.gt(0) ? subjectTotal.minus(comparisonTotal).times(100).div(comparisonTotal).toFixed(2) : null,
    comparisonWeekTotal: comparisonTotal?.gt(0) ? comparisonTotal.toString() : null,
    isoWeek: firstPeriod.isoWeek,
    isoWeekYear: firstPeriod.isoWeekYear,
    subjectWeekTotal: subjectTotal.toString(),
    topCategory: { amount: top.amount.toString(), categoryKey: top.categoryKey, displayName: top.displayName },
  };
  return { facts, status: 'ok', subjectWeek: firstPeriod.subjectWeek } as const;
}

function budgetPeriodsAgree(results: BudgetAggregationResult[]) {
  const first = results[0];
  if (!first) return true;
  return results.every((result) => result.period.localDate === first.period.localDate && result.period.month === first.period.month && result.period.year === first.period.year && result.period.day.start.getTime() === first.period.day.start.getTime() && result.period.day.end.getTime() === first.period.day.end.getTime() && result.period.monthRange.start.getTime() === first.period.monthRange.start.getTime() && result.period.monthRange.end.getTime() === first.period.monthRange.end.getTime());
}

/** The financial emails ship in EN and PT; everything else falls back to EN — same convention as `financial-email-rendering.service.ts`'s `intlLocale`. */
function monthLabelFor(period: { month: number; year: number }, language: SupportedLanguages): string {
  const locale = language === SupportedLanguages.PT ? 'pt-PT' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
}

function result(resultCode: 'dry_run' | 'suppressed', reason: string, counts: Record<string, number> = {}) {
  return { counts, reason, result: resultCode };
}

function weeklyPeriod(period: BudgetAggregationResult['period'] | WeeklyAggregationResult['period']): LisbonWeeklyPeriod | null {
  return 'isoWeek' in period ? period : null;
}
