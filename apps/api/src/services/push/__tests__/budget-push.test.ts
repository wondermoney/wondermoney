import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { PushDevice, PushDevicePlatform } from '@entity/PushDevice';
import type { BudgetThresholdFact } from '@service/budget/aggregation-types';
import { FinancialEmailCandidateRepository } from '@service/email/financial-email-candidate.repository';
import { FinancialEmailUserWorkerService } from '@service/email/financial-email-user-worker.service';
import type { Enqueue } from '@service/queue/enqueue';

import { BudgetPushNotifier } from '../budget-push';
import { type PushNotification, renderPush } from '../push-messages';

type WorkerDeps = NonNullable<ConstructorParameters<typeof FinancialEmailUserWorkerService>[0]>;

const fact = (overrides: Partial<BudgetThresholdFact & { tenantKey: number }> = {}): BudgetThresholdFact & { tenantKey: number } => ({
  actualPercentage: '123.45',
  amountBudgeted: '400.00',
  amountSpent: '493.80',
  budgetKey: 3,
  budgetName: 'Household 2026',
  budgetTemplateCategoryKey: 9,
  categoryKey: 4,
  categoryName: 'Groceries',
  claimThresholds: [80, 100],
  currencyCode: 'EUR',
  month: 11,
  parentCategoryName: 'Food',
  remainingOrOverAmount: '93.80',
  state: 'over',
  tenantKey: 1,
  threshold: 100,
  year: 2026,
  ...overrides,
});

/*
 * A budget alert on a lock screen says which budget, never the figures. It is its own switch,
 * pushed once per threshold crossing, and a person who turned the email off still gets the push.
 */
describe('budget alerts as push', () => {
  const db = useTestDatabase();

  async function pushReady(em: EntityManager, household: Household, budgetPush = true) {
    em.create(EmailNotificationPreference, { appuserKey: household.appuser, budgetAlertsEnabled: false, pushBudgetAlertsEnabled: budgetPush }, { partial: true });
    em.create(PushDevice, { appuserKey: household.appuser, platform: PushDevicePlatform.IOS, sessionId: 'session-1', token: `ExponentPushToken[budget-${household.appuser.appuserKey}]` }, { partial: true });
    await em.flush();
  }

  function queue(fail = false) {
    const sent: { notification: PushNotification }[] = [];
    const enqueue = {
      send: (_queue: string, payload: { notification: PushNotification }) => {
        if (fail) return Promise.reject(new Error('queue down'));
        sent.push(payload);
        return Promise.resolve('job');
      },
      sendAfter: () => Promise.resolve('job'),
    } as unknown as Enqueue;
    return { enqueue, sent };
  }

  it('puts no amount in the notification, in any language', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household);
    const { enqueue, sent } = queue();

    expect(await new BudgetPushNotifier({ em, enabled: () => true, enqueue }).notify(household.appuser.appuserKey, [fact()])).toBe('queued');

    const payload = JSON.stringify(sent);
    for (const figure of ['493', '400', '93.8', '123', 'EUR', '€']) expect(payload).not.toContain(figure);
    for (const language of ['en', 'pt', 'es'] as const) {
      const [first] = sent;
      if (!first) throw new Error('nothing was queued');
      const rendered = renderPush(first.notification, language);
      expect(rendered.body).toContain('Groceries');
      expect(`${rendered.title} ${rendered.body}`).not.toMatch(/\d/u);
    }
  });

  it('pushes each crossing once, however many daily runs see it', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household);
    const { enqueue, sent } = queue();
    const notifier = new BudgetPushNotifier({ em, enabled: () => true, enqueue });

    await notifier.notify(household.appuser.appuserKey, [fact({ claimThresholds: [80], state: 'near', threshold: 80 })]);
    expect(await notifier.notify(household.appuser.appuserKey, [fact({ claimThresholds: [80], state: 'near', threshold: 80 })])).toBe('no_new_crossings');
    // Going over later is a new crossing.
    await notifier.notify(household.appuser.appuserKey, [fact({ claimThresholds: [80, 100] })]);

    expect(sent.map((payload) => (payload.notification as Extract<PushNotification, { kind: 'budget_alert' }>).budgets.map((budget) => budget.state))).toEqual([['near'], ['over']]);
  });

  it('pushes nothing to someone who left budget push off, or while push is off on the server', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household, false);
    const { enqueue, sent } = queue();

    expect(await new BudgetPushNotifier({ em, enabled: () => true, enqueue }).notify(household.appuser.appuserKey, [fact()])).toBe('skipped');
    await em.nativeUpdate(EmailNotificationPreference, { appuserKey: household.appuser }, { pushBudgetAlertsEnabled: true });
    expect(await new BudgetPushNotifier({ em: db.em(), enabled: () => false, enqueue }).notify(household.appuser.appuserKey, [fact()])).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('tries a crossing again next run when it could not be queued', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household);

    expect(await new BudgetPushNotifier({ em, enabled: () => true, enqueue: queue(true).enqueue }).notify(household.appuser.appuserKey, [fact()])).toBe('failed');
    const { enqueue, sent } = queue();
    expect(await new BudgetPushNotifier({ em: db.em(), enabled: () => true, enqueue }).notify(household.appuser.appuserKey, [fact()])).toBe('queued');
    expect(sent).toHaveLength(1);
  });

  it('pushes from the daily budget run to someone who turned the email off but the push on', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household);
    const { enqueue, sent } = queue();
    const range = { end: new Date('2026-11-14T00:00:00Z'), start: new Date('2026-11-13T00:00:00Z') };
    const aggregation = { aggregateBudgetThresholds: vi.fn(({ tenantKey }: { tenantKey: number }) => Promise.resolve({ appuserKey: household.appuser.appuserKey, diagnostics: {}, facts: [fact({ tenantKey })], period: { day: range, localDate: '2026-11-13', month: 11, monthRange: range, scheduledFor: range.start, year: 2026 }, status: 'ok', suppressedBudgets: [], tenantKey })) };
    const orchestration = { deliverBudget: vi.fn() };
    const preferences = { getFreshWorkerEligibility: vi.fn().mockResolvedValue({ appuserKey: household.appuser.appuserKey, currencyCode: 'EUR', deliverySupported: true, effectiveEnabled: false, emailAddress: household.appuser.emailAddress, firstName: null, storedEnabled: false }) };
    const service = new FinancialEmailUserWorkerService({
      aggregation: aggregation as unknown as NonNullable<WorkerDeps['aggregation']>,
      budgetPush: new BudgetPushNotifier({ em, enabled: () => true, enqueue }),
      em,
      now: () => new Date('2026-11-13T09:00:00Z'),
      orchestration: orchestration as unknown as NonNullable<WorkerDeps['orchestration']>,
      preferences: preferences as unknown as NonNullable<WorkerDeps['preferences']>,
    });

    await expect(service.process({ appuserKey: household.appuser.appuserKey, scheduledFor: '2026-11-13T09:00:00Z', stream: 'budget' })).resolves.toMatchObject({ reason: 'preference_disabled', result: 'suppressed' });
    expect(sent).toHaveLength(1);
    expect(orchestration.deliverBudget).not.toHaveBeenCalled();
  });

  it('makes a push-only person a candidate for the daily run only while push is on', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    await pushReady(em, household);

    await expect(new FinancialEmailCandidateRepository(db.em(), () => false).page('budget')).resolves.toEqual([]);
    await expect(new FinancialEmailCandidateRepository(db.em(), () => true).page('budget')).resolves.toEqual([household.appuser.appuserKey]);
    await expect(new FinancialEmailCandidateRepository(db.em(), () => true).page('weekly')).resolves.toEqual([household.appuser.appuserKey]);
  });
});
