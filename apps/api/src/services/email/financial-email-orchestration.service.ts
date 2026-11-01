import { SHOULD_INTERCEPT_EMAILS } from '@config/env';
import { SupportedLanguages } from '@entity/Appuser';
import type { BudgetThresholdFact, MonthlyStoryFacts, WeeklyInsightFacts } from '@service/budget/aggregation-types';
import type { RenderedEmailOutcome } from '@service/email/email';
import { budgetCrossingKey, budgetEnvelopeKey, type CrossingReservation, type FinancialDeliveryResult, FinancialEmailReservationService, monthlyEnvelopeKey, weeklyEnvelopeKey } from '@service/email/financial-email-delivery.service';
import { FinancialEmailRenderingService, type RenderedEmailAdapter } from '@service/email/financial-email-rendering.service';

export type FinancialOrchestrationResult =
  | Exclude<FinancialDeliveryResult, { result: 'reserved' } | { result: 'suppressed' }>
  | { reason: 'delivery_unsupported' | 'interception_enabled' | 'invalid_recipient' | 'no_facts' | 'no_new_claims' | 'preference_disabled' | 'render_failed' | 'reservation_blocked'; result: 'suppressed' };

/** The shape a monthly-story renderer (Task 17's `renderMonthlyStory`) produces — headers/html/subject/text, minus the `to` recipient which `sendReserved` fills in. */
export interface RenderedMonthlyStoryInput {
  headers: Record<string, string>;
  html: string;
  subject: string;
  text: string;
}

interface CommonInput {
  appuserKey: number;
  deliverySupported: boolean;
  effectivelyEnabled: boolean;
  firstName?: string;
  language: SupportedLanguages;
  recipient: string;
}

interface StoredSnapshot {
  candidateFacts?: (BudgetThresholdFact & { tenantKey: number })[];
  crossings?: CrossingReservation[];
  monthlyStoryFacts?: MonthlyStoryFacts;
  rendered?: { headers: Record<string, string>; html: string; subject: string; text: string };
  subjectWeek?: { end: Date; start: Date };
  weeklyFacts?: WeeklyInsightFacts;
}

export class FinancialEmailOrchestrationService {
  constructor(
    private readonly reservations: FinancialEmailReservationService,
    private readonly rendering: FinancialEmailRenderingService,
    private readonly adapter: RenderedEmailAdapter,
    private readonly interceptionEnabled: () => boolean = () => SHOULD_INTERCEPT_EMAILS,
  ) {}

  async deliverBudget(input: CommonInput & { facts: (BudgetThresholdFact & { tenantKey: number })[]; localDate: string }): Promise<FinancialOrchestrationResult> {
    const suppressed = this.preflight(input, input.facts.length);
    if (suppressed) return suppressed;
    const deliveryKey = budgetEnvelopeKey(input.localDate);
    let snapshot = asSnapshot(await this.reservations.loadRetrySnapshot(input.appuserKey, deliveryKey));
    snapshot ??= {
        candidateFacts: input.facts,
        crossings: input.facts.flatMap((fact) => fact.claimThresholds.map((threshold) => ({ budgetKey: fact.budgetKey, budgetTemplateCategoryKey: fact.budgetTemplateCategoryKey, month: fact.month, tenantKey: fact.tenantKey, threshold, year: fact.year }))),
      };
    const reservation = await this.reservations.reserveBudget({ appuserKey: input.appuserKey, crossings: snapshot.crossings ?? [], localDate: input.localDate, snapshot: snapshot as unknown as Record<string, unknown> });
    if (reservation.result !== 'reserved') return { reason: reservation.result === 'suppressed' && reservation.reason === 'no_new_claims' ? 'no_new_claims' : 'reservation_blocked', result: 'suppressed' };
    snapshot = asSnapshot(reservation.snapshot) ?? snapshot;
    if (!snapshot.rendered) {
      const newKeys = new Set(reservation.newlyAcquiredCrossingKeys);
      const filteredFacts = (snapshot.candidateFacts ?? []).filter((fact) => fact.claimThresholds.some((threshold) => newKeys.has(budgetCrossingKey({ budgetKey: fact.budgetKey, budgetTemplateCategoryKey: fact.budgetTemplateCategoryKey, month: fact.month, tenantKey: fact.tenantKey, threshold, year: fact.year }))));
      try {
        const rendered = await this.rendering.renderBudget({ ...input, facts: filteredFacts });
        snapshot = { ...snapshot, candidateFacts: filteredFacts, rendered: { headers: rendered.headers, html: rendered.html, subject: rendered.subject, text: rendered.text } };
        if (!(await this.reservations.persistRenderedSnapshot(input.appuserKey, reservation.deliveryKey, snapshot as unknown as Record<string, unknown>))) throw new Error('snapshot_not_persisted');
      } catch {
        await this.reservations.failBeforeProvider(input.appuserKey, reservation.deliveryKey, 'render_failed');
        return { reason: 'render_failed', result: 'suppressed' };
      }
    }
    return this.sendReserved(input.appuserKey, reservation.deliveryKey, input.recipient, snapshot);
  }

  async deliverMonthlyStory(input: CommonInput & { month: number; render: () => Promise<RenderedMonthlyStoryInput>; year: number }): Promise<FinancialOrchestrationResult> {
    const suppressed = this.preflight(input, 1);
    if (suppressed) return suppressed;
    const deliveryKey = monthlyEnvelopeKey(input.year, input.month);
    let snapshot = asSnapshot(await this.reservations.loadRetrySnapshot(input.appuserKey, deliveryKey));
    snapshot ??= {};
    const reservation = await this.reservations.reserveMonthly({ appuserKey: input.appuserKey, month: input.month, snapshot: snapshot as unknown as Record<string, unknown>, year: input.year });
    if (reservation.result !== 'reserved') return { reason: 'reservation_blocked', result: 'suppressed' };
    snapshot = asSnapshot(reservation.snapshot) ?? snapshot;
    if (!snapshot.rendered) {
      try {
        const rendered = await input.render();
        snapshot = { ...snapshot, rendered: { headers: rendered.headers, html: rendered.html, subject: rendered.subject, text: rendered.text } };
        if (!(await this.reservations.persistRenderedSnapshot(input.appuserKey, reservation.deliveryKey, snapshot as unknown as Record<string, unknown>))) throw new Error('snapshot_not_persisted');
      } catch {
        await this.reservations.failBeforeProvider(input.appuserKey, reservation.deliveryKey, 'render_failed');
        return { reason: 'render_failed', result: 'suppressed' };
      }
    }
    return this.sendReserved(input.appuserKey, reservation.deliveryKey, input.recipient, snapshot);
  }

  async deliverWeekly(input: CommonInput & { currencyCode: string; facts: WeeklyInsightFacts; isoWeek: number; isoWeekYear: number; subjectWeek: { end: Date; start: Date } }): Promise<FinancialOrchestrationResult> {
    const suppressed = this.preflight(input, 1);
    if (suppressed) return suppressed;
    const deliveryKey = weeklyEnvelopeKey(input.isoWeekYear, input.isoWeek);
    let snapshot = asSnapshot(await this.reservations.loadRetrySnapshot(input.appuserKey, deliveryKey));
    snapshot ??= { subjectWeek: input.subjectWeek, weeklyFacts: input.facts };
    const reservation = await this.reservations.reserveWeekly({ appuserKey: input.appuserKey, isoWeek: input.isoWeek, isoWeekYear: input.isoWeekYear, snapshot: snapshot as unknown as Record<string, unknown> });
    if (reservation.result !== 'reserved') return { reason: 'reservation_blocked', result: 'suppressed' };
    snapshot = asSnapshot(reservation.snapshot) ?? snapshot;
    if (!snapshot.rendered) {
      try {
        const rendered = await this.rendering.renderWeekly({ ...input, facts: snapshot.weeklyFacts ?? input.facts, subjectWeek: normalizeRange(snapshot.subjectWeek ?? input.subjectWeek) });
        snapshot = { ...snapshot, rendered: { headers: rendered.headers, html: rendered.html, subject: rendered.subject, text: rendered.text } };
        if (!(await this.reservations.persistRenderedSnapshot(input.appuserKey, reservation.deliveryKey, snapshot as unknown as Record<string, unknown>))) throw new Error('snapshot_not_persisted');
      } catch {
        await this.reservations.failBeforeProvider(input.appuserKey, reservation.deliveryKey, 'render_failed');
        return { reason: 'render_failed', result: 'suppressed' };
      }
    }
    return this.sendReserved(input.appuserKey, reservation.deliveryKey, input.recipient, snapshot);
  }

  private preflight(input: CommonInput, factCount: number): FinancialOrchestrationResult | null {
    if (this.interceptionEnabled()) return { reason: 'interception_enabled', result: 'suppressed' };
    if (!input.effectivelyEnabled) return { reason: 'preference_disabled', result: 'suppressed' };
    if (!input.deliverySupported) return { reason: 'delivery_unsupported', result: 'suppressed' };
    if (!input.recipient.includes('@') || input.recipient.includes(' ')) return { reason: 'invalid_recipient', result: 'suppressed' };
    if (factCount === 0) return { reason: 'no_facts', result: 'suppressed' };
    return null;
  }

  private async sendReserved(appuserKey: number, deliveryKey: string, recipient: string, snapshot: StoredSnapshot): Promise<FinancialOrchestrationResult> {
    if (!snapshot.rendered || !(await this.reservations.recordProviderStart(appuserKey, deliveryKey))) return { reason: 'reservation_blocked', result: 'suppressed' };
    let outcome: RenderedEmailOutcome;
    try {
      outcome = await this.adapter({ ...snapshot.rendered, to: { email: recipient } });
    } catch {
      outcome = { type: 'unknown' } as const;
    }
    if (outcome.type === 'intercepted') outcome = { type: 'unknown' };
    return this.reservations.transitionOutcome(appuserKey, deliveryKey, outcome) as Promise<FinancialOrchestrationResult>;
  }
}

function asSnapshot(value: null | Record<string, unknown>): null | StoredSnapshot {
  if (!value) return null;
  return value;
}

function normalizeRange(range: { end: Date; start: Date }) {
  return { end: new Date(range.end), start: new Date(range.start) };
}
