import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';

import { EmailGlobalOptOutService } from '../email-global-opt-out.service';
import { FinancialEmailOrchestrationService } from '../financial-email-orchestration.service';
import { FinancialEmailRenderingService } from '../financial-email-rendering.service';

type FinancialOrchestrationRendering = ConstructorParameters<typeof FinancialEmailOrchestrationService>[1];
type FinancialOrchestrationReservations = ConstructorParameters<typeof FinancialEmailOrchestrationService>[0];

const optOutService = new EmailGlobalOptOutService({ secret: 'package-render-test-secret-at-least-32-characters' });
const rendering = new FinancialEmailRenderingService({ optOutService });

const budgetFact = {
  actualPercentage: '100.00',
  amountBudgeted: '100',
  amountSpent: '100',
  budgetKey: 2,
  budgetName: 'Casa <script>alert(1)</script>',
  budgetTemplateCategoryKey: 3,
  categoryKey: 4,
  categoryName: 'Supermercado & filhos',
  claimThresholds: [80, 100] as (80 | 100)[],
  currencyCode: 'EUR',
  month: 7,
  parentCategoryName: 'Casa',
  remainingOrOverAmount: '0',
  state: 'at_limit' as const,
  tenantKey: 1,
  threshold: 100 as const,
  year: 2026,
};

describe('installed React Email package rendering', () => {
  // The hosted instance points email footers at its public privacy policy.
  beforeEach(() => {
    vi.stubEnv('PRIVACY_POLICY_URL', 'https://docs.wonder.money/{lang}/about/privacy-policy');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders production budget props with escaping, tracking and unsubscribe headers', async () => {
    const rendered = await rendering.renderBudget({ appuserKey: 7, facts: [budgetFact], firstName: 'João', language: SupportedLanguages.PT, recipient: 'user@example.com' });
    expect(rendered.subject).toBe('Há categorias que atingiram o valor definido');
    expect(rendered.preheader).toBe('Algumas categorias atingiram o valor definido para este mês.');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).toContain('utm_source=financial_notification');
    expect(rendered.html).toContain('/pt/settings?tab=notifications');
    expect(rendered.html).toContain('https://docs.wonder.money/pt/about/privacy-policy');
    expect(rendered.html).toContain('julho de 2026');
    expect(rendered.html).toContain('100%');
    expect(rendered.html).not.toContain('100.00%');
    expect(rendered.text).toContain('Supermercado & filhos');
    expect(rendered.headers['List-Unsubscribe']).toContain('/v1/marketing/email-opt-out?token=');
    expect(rendered.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('renders the budget alert in EN with English copy, /en URLs and en-GB formatting', async () => {
    const rendered = await rendering.renderBudget({ appuserKey: 7, facts: [budgetFact], firstName: 'John', language: SupportedLanguages.EN, recipient: 'user@example.com' });
    expect(rendered.subject).toBe('Some categories hit their set amount');
    expect(rendered.preheader).toBe('Some categories reached the amount set for this month.');
    expect(rendered.html).toContain('/en/settings?tab=notifications');
    expect(rendered.html).toContain('https://docs.wonder.money/en/about/privacy-policy');
    expect(rendered.html).toContain('next=%2Fen%2Fbudgets');
    expect(rendered.html).toContain('July 2026');
    expect(rendered.html).not.toContain('julho');
    expect(rendered.html).toContain('Categories to review in your budgets');
    expect(rendered.html).toContain('Hi John,');
  });

  it('renders the weekly summary in EN with English copy, /en URLs and en-GB comparison wording', async () => {
    const rendered = await rendering.renderWeekly({
      appuserKey: 7, currencyCode: 'EUR',
      facts: {
        activeBudgetStatus: 'near',
        comparisonPercentage: '-12.5',
        comparisonWeekTotal: '80',
        isoWeek: 29,
        isoWeekYear: 2026,
        subjectWeekTotal: '90',
        topCategory: { amount: '50', categoryKey: 4, displayName: 'Groceries' },
      },
      language: SupportedLanguages.EN,
      recipient: 'user@example.com',
      subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') },
    });
    expect(rendered.subject).toBe('Your weekly money summary');
    expect(rendered.preheader).toBe('Spending, top category and budget status for the completed week.');
    expect(rendered.html).toContain('Completed week of 6 to 12 July 2026');
    expect(rendered.html).toContain('Compared to the previous week');
    expect(rendered.html).toContain('12.5% below');
    expect(rendered.html).not.toContain('abaixo');
    expect(rendered.html).toContain('next=%2Fen');
  });

  it('renders production weekly props without preview/sample values', async () => {
    const rendered = await rendering.renderWeekly({
      appuserKey: 7, currencyCode: 'EUR',
      facts: {
        activeBudgetStatus: 'near',
        comparisonPercentage: null,
        comparisonWeekTotal: null,
        isoWeek: 29,
        isoWeekYear: 2026,
        subjectWeekTotal: '90',
        topCategory: { amount: '50', categoryKey: 4, displayName: 'Alimentação / Mercado' },
      },
      language: SupportedLanguages.PT,
      recipient: 'user@example.com',
      subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') },
    });
    expect(rendered.subject).toBe('O resumo da tua semana financeira');
    expect(rendered.preheader).toBe('Gastos, categoria principal e estado dos orçamentos da semana completa.');
    expect(rendered.html).toContain('Semana completa de 6 a 12 de julho de 2026');
    expect(rendered.html).toContain('https://docs.wonder.money/pt/about/privacy-policy');
    expect(rendered.text).toContain('Alimentação / Mercado');
    expect(rendered.html).not.toContain('Maria');
    expect(rendered.html).toContain('utm_campaign=weekly_insights');
    expect(rendered.html).toContain('next=%2Fpt');
  });

  it.each([
    ['positive', '12.5', '80', '12,5% acima'],
    ['negative', '-12.5', '80', '12,5% abaixo'],
    ['zero', '-0', '80', 'sem alteração'],
  ])('renders %s previous-week comparison with PT formatting', async (_variant, comparisonPercentage, comparisonWeekTotal, expectedValue) => {
    const rendered = await rendering.renderWeekly({
      appuserKey: 7, currencyCode: 'EUR',
      facts: {
        activeBudgetStatus: null,
        comparisonPercentage,
        comparisonWeekTotal,
        isoWeek: 29,
        isoWeekYear: 2026,
        subjectWeekTotal: '90',
        topCategory: { amount: '50', categoryKey: 4, displayName: 'Alimentação / Mercado' },
      },
      language: SupportedLanguages.PT,
      recipient: 'user@example.com',
      subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') },
    });
    expect(rendered.html).toContain('Comparação com a semana anterior');
    expect(rendered.html).toContain(expectedValue);
    expect(rendered.text).toContain('Comparação com a semana anterior');
    expect(rendered.text).toContain(expectedValue);
    expect(rendered.html).not.toContain('12.5%');
  });

  it('omits previous-week comparison when prior week is unavailable', async () => {
    const rendered = await rendering.renderWeekly({
      appuserKey: 7, currencyCode: 'EUR',
      facts: {
        activeBudgetStatus: null,
        comparisonPercentage: null,
        comparisonWeekTotal: null,
        isoWeek: 29,
        isoWeekYear: 2026,
        subjectWeekTotal: '90',
        topCategory: { amount: '50', categoryKey: 4, displayName: 'Alimentação / Mercado' },
      },
      language: SupportedLanguages.PT,
      recipient: 'user@example.com',
      subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') },
    });
    expect(rendered.html).not.toContain('Comparação com a semana anterior');
    expect(rendered.text).not.toContain('Comparação com a semana anterior');
  });

  it('renders a monthly story email in PT with formatted facts, category deltas and net worth', async () => {
    const rendered = await rendering.renderMonthlyStory({
      appuserKey: 7,
      currencyCode: 'EUR',
      facts: {
        budgetPressure: 'over',
        categoryDeltas: [{ baselineAmount: '100', categoryKey: 4, direction: 'increase', displayName: 'Restaurantes', percentOfBaseline: '420.00', subjectAmount: '520' }],
        incomeBaseline: '2000',
        incomeSubject: '2000',
        recurringChanges: [],
        savingsRateBaseline: null,
        savingsRateSubject: null,
        spendingBaseline: '1400',
        spendingSubject: '1820',
      },
      firstName: 'Marta',
      language: SupportedLanguages.PT,
      monthLabel: 'julho de 2026',
      narrativeSentences: ['Julho foi 420,00 € mais caro do que o habitual.'],
      netWorth: { subject: '50100', tone: 'positive' },
      recipient: 'marta@example.com',
    });
    expect(rendered.subject).toBeTruthy();
    expect(rendered.preheader).toBe('Julho foi 420,00 € mais caro do que o habitual.');
    expect(rendered.html).toContain('Marta');
    expect(rendered.html).toContain('Restaurantes');
    expect(rendered.html).toContain('julho de 2026');
    expect(rendered.html).toContain('/pt/reports');
    expect(rendered.html).toContain('/pt/settings?tab=notifications');
    expect(rendered.html).toContain('https://docs.wonder.money/pt/about/privacy-policy');
    expect(rendered.headers['List-Unsubscribe']).toContain('/v1/marketing/email-opt-out?token=');
    expect(rendered.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // budgetPressure: 'over' must surface the localized status/detail panel copy.
    expect(rendered.html).toContain('Acima do orçamento');
    expect(rendered.html).toContain('Ultrapassaste o orçamento numa ou mais categorias este mês.');
  });

  it.each(['near', 'over'] as const)('surfaces a localized budget-pressure panel in EN when budgetPressure is %s', async (budgetPressure) => {
    const enStatus = budgetPressure === 'near' ? 'Close to budget' : 'Over budget';
    // The template HTML-entity-encodes apostrophes (e.g. "You're" -> "You&#x27;re"), so assert on
    // an apostrophe-free slice of the detail copy rather than the literal sentence.
    const enDetail = budgetPressure === 'near' ? 'close to your budget limits this month.' : 'You went over budget in one or more categories this month.';
    const rendered = await rendering.renderMonthlyStory({
      appuserKey: 7,
      currencyCode: 'EUR',
      facts: {
        budgetPressure,
        categoryDeltas: [],
        incomeBaseline: '2000',
        incomeSubject: '2000',
        recurringChanges: [],
        savingsRateBaseline: null,
        savingsRateSubject: null,
        spendingBaseline: '1400',
        spendingSubject: '1400',
      },
      firstName: 'John',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      narrativeSentences: ['July was a typical month.'],
      netWorth: null,
      recipient: 'john@example.com',
    });
    expect(rendered.html).toContain(enStatus);
    expect(rendered.html).toContain(enDetail);
  });

  it.each([null, 'within_plan'] as const)('omits the budget-pressure panel when budgetPressure is %s', async (budgetPressure) => {
    const rendered = await rendering.renderMonthlyStory({
      appuserKey: 7,
      currencyCode: 'EUR',
      facts: {
        budgetPressure,
        categoryDeltas: [],
        incomeBaseline: '2000',
        incomeSubject: '2000',
        recurringChanges: [],
        savingsRateBaseline: null,
        savingsRateSubject: null,
        spendingBaseline: '1400',
        spendingSubject: '1400',
      },
      firstName: 'John',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      narrativeSentences: ['July was a typical month.'],
      netWorth: null,
      recipient: 'john@example.com',
    });
    expect(rendered.html).not.toContain('Close to budget');
    expect(rendered.html).not.toContain('Over budget');
    expect(rendered.html).not.toContain('budget limits');
  });

  it('renders a monthly story email in EN with recurring changes, savings rate and no net worth', async () => {
    const rendered = await rendering.renderMonthlyStory({
      appuserKey: 7,
      currencyCode: 'EUR',
      facts: {
        budgetPressure: null,
        categoryDeltas: [],
        incomeBaseline: '2000',
        incomeSubject: '2200',
        recurringChanges: [
          { displayName: 'Netflix', kind: 'changed', newAmount: '15.99', previousAmount: '12.99', recurringSeriesKey: 1 },
          { displayName: 'Gym membership', kind: 'new', newAmount: '30', previousAmount: null, recurringSeriesKey: 2 },
        ],
        savingsRateBaseline: '20',
        savingsRateSubject: '25',
        spendingBaseline: '1400',
        spendingSubject: '1400',
      },
      firstName: 'John',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      narrativeSentences: ["July was your best savings month yet."],
      netWorth: null,
      recipient: 'john@example.com',
    });
    expect(rendered.subject).toBeTruthy();
    expect(rendered.html).toContain('Hi John,');
    expect(rendered.html).toContain('Netflix');
    expect(rendered.html).toContain('Gym membership');
    expect(rendered.html).toContain('/en/reports');
    expect(rendered.html).toContain('/en/settings?tab=notifications');
    expect(rendered.html).toContain('https://docs.wonder.money/en/about/privacy-policy');
  });

  it('omits the savings-rate baseline (never renders "null%") when the subject rate exists but the baseline is null', async () => {
    // savingsRateBaseline is independently null (baseline-period income was non-positive) while the
    // subject rate is present -> formattedBaseline must be absent, not the literal string "null%".
    const monthlyStoryRenderer = vi.fn().mockResolvedValue({ html: '<p>ok</p>', preheader: 'p', subject: 's', text: 'ok' });
    const spyRendering = new FinancialEmailRenderingService({ monthlyStoryRenderer, optOutService });
    await spyRendering.renderMonthlyStory({
      appuserKey: 7,
      currencyCode: 'EUR',
      facts: {
        budgetPressure: null,
        categoryDeltas: [],
        incomeBaseline: '0',
        incomeSubject: '2200',
        recurringChanges: [],
        savingsRateBaseline: null,
        savingsRateSubject: '25',
        spendingBaseline: '0',
        spendingSubject: '1400',
      },
      firstName: 'John',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      narrativeSentences: ['July was your best savings month yet.'],
      netWorth: null,
      recipient: 'john@example.com',
    });
    const props = monthlyStoryRenderer.mock.calls[0]?.[0] as { savingsRateMetric?: { formattedBaseline?: string; formattedValue: string } };
    const metric = props.savingsRateMetric;
    expect(metric).toBeDefined();
    expect(metric?.formattedValue).toBe('25%');
    expect(metric?.formattedBaseline).toBeUndefined();
    expect(metric && 'formattedBaseline' in metric).toBe(false);
  });

  it('renders the insufficient-data monthly story variant when history is too short', async () => {
    const rendered = await rendering.renderMonthlyStoryInsufficient({
      appuserKey: 7,
      firstName: 'Marta',
      language: SupportedLanguages.PT,
      monthLabel: 'julho de 2026',
      monthsAvailable: 1,
      monthsNeeded: 3,
      reason: 'insufficient_history',
      recipient: 'marta@example.com',
    });
    expect(rendered.subject).toBeTruthy();
    expect(rendered.html).toContain('Marta');
    expect(rendered.html).toContain('/pt/reports');
    expect(rendered.headers['List-Unsubscribe']).toContain('/v1/marketing/email-opt-out?token=');
  });

  it('renders the insufficient-data monthly story variant with subject-month totals when reason is zero_activity and currencyCode is available', async () => {
    const rendered = await rendering.renderMonthlyStoryInsufficient({
      appuserKey: 7,
      currencyCode: 'EUR',
      firstName: 'John',
      incomeSubject: '2000',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      monthsAvailable: 1,
      monthsNeeded: 3,
      reason: 'zero_activity',
      recipient: 'john@example.com',
      spendingSubject: '0',
    });
    expect(rendered.subject).toBeTruthy();
    expect(rendered.html).toContain('Hi John,');
  });

  it('omits the metrics panel in the insufficient-data variant when currencyCode is unavailable, even with subject totals present', async () => {
    const withoutCurrency = await rendering.renderMonthlyStoryInsufficient({
      appuserKey: 7,
      firstName: 'John',
      incomeSubject: '2000',
      language: SupportedLanguages.EN,
      monthLabel: 'July 2026',
      monthsAvailable: 1,
      monthsNeeded: 3,
      reason: 'zero_activity',
      recipient: 'john@example.com',
      spendingSubject: '0',
    });
    expect(withoutCurrency.html).not.toContain('2,000.00');
  });

  it('orchestrates direct jump once and passes exact rendered payload to the adapter', async () => {
    const adapter = vi.fn().mockResolvedValue({ providerMessageIds: ['provider-1'], type: 'accepted' });
    const reserveBudget = vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ba:d:20260718', newlyAcquiredCrossingKeys: ['ba:c:1:2:3:202607:80', 'ba:c:1:2:3:202607:100'], result: 'reserved', snapshot }));
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(null),
      persistRenderedSnapshot: vi.fn().mockResolvedValue(true),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveBudget,
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => false);
    await expect(service.deliverBudget({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, facts: [budgetFact], language: SupportedLanguages.PT, localDate: '2026-07-18', recipient: 'user@example.com' })).resolves.toEqual({ result: 'accepted' });
    expect(reserveBudget.mock.calls[0]?.[0].crossings.map((claim: { threshold: number }) => claim.threshold)).toEqual([80, 100]);
    expect(adapter).toHaveBeenCalledOnce();
    expect(adapter.mock.calls[0]?.[0]).toMatchObject({ subject: 'Há categorias que atingiram o valor definido', to: { email: 'user@example.com' } });
    expect(reservations.recordProviderStart).toHaveBeenCalledOnce();
    expect(reservations.transitionOutcome).toHaveBeenCalledWith(7, 'ba:d:20260718', { providerMessageIds: ['provider-1'], type: 'accepted' });
  });

  it('renders only facts with newly acquired claims in a mixed satisfied/new reservation', async () => {
    const newFact = { ...budgetFact, budgetKey: 8, budgetName: 'Novo orçamento', budgetTemplateCategoryKey: 9, categoryKey: 10, categoryName: 'Nova categoria', claimThresholds: [80] as (80 | 100)[], state: 'near' as const, threshold: 80 as const };
    const adapter = vi.fn().mockResolvedValue({ providerMessageIds: ['mixed-id'], type: 'accepted' });
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(null),
      persistRenderedSnapshot: vi.fn().mockResolvedValue(true),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveBudget: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ba:d:20260718', newlyAcquiredCrossingKeys: ['ba:c:1:8:9:202607:80'], result: 'reserved', snapshot })),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => false);
    await service.deliverBudget({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, facts: [budgetFact, newFact], language: SupportedLanguages.PT, localDate: '2026-07-18', recipient: 'user@example.com' });
    const sent = adapter.mock.calls[0]?.[0];
    expect(sent.html).toContain('Novo orçamento');
    expect(sent.html).not.toContain('Casa &lt;script&gt;');
  });

  it('orchestrates weekly rendering with one envelope and one adapter call', async () => {
    const adapter = vi.fn().mockResolvedValue({ providerMessageIds: ['weekly-provider'], type: 'accepted' });
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(null),
      persistRenderedSnapshot: vi.fn().mockResolvedValue(true),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveWeekly: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'wi:w:2026-W29', newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot })),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => false);
    await expect(service.deliverWeekly({
      appuserKey: 7, currencyCode: 'EUR',
      deliverySupported: true,
      effectivelyEnabled: true,
      facts: { activeBudgetStatus: null, comparisonPercentage: null, comparisonWeekTotal: null, isoWeek: 29, isoWeekYear: 2026, subjectWeekTotal: '90', topCategory: { amount: '50', categoryKey: 4, displayName: 'Alimentação / Mercado' } },
      isoWeek: 29,
      isoWeekYear: 2026,
      language: SupportedLanguages.PT,
      recipient: 'user@example.com',
      subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') },
    })).resolves.toEqual({ result: 'accepted' });
    expect(reservations.reserveWeekly).toHaveBeenCalledOnce();
    expect(adapter).toHaveBeenCalledOnce();
    expect(adapter.mock.calls[0]?.[0]).toMatchObject({ subject: 'O resumo da tua semana financeira', to: { email: 'user@example.com' } });
  });

  it('reserves once, renders, sends, and does not re-render on a retry with a persisted snapshot', async () => {
    const rendered = { headers: { 'X-Test': 'true' }, html: '<p>story</p>', subject: 'Your Monthly Money Story', text: 'story' };
    const render = vi.fn().mockResolvedValue(rendered);
    const adapter = vi.fn().mockResolvedValue({ providerMessageIds: ['monthly-provider'], type: 'accepted' });
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(null),
      persistRenderedSnapshot: vi.fn().mockResolvedValue(true),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveMonthly: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ms:m:202607', newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot })),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => false);
    await expect(service.deliverMonthlyStory({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, language: SupportedLanguages.PT, month: 7, recipient: 'user@example.com', render, year: 2026 })).resolves.toEqual({ result: 'accepted' });
    expect(reservations.reserveMonthly).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(reservations.persistRenderedSnapshot).toHaveBeenCalledOnce();
    expect(adapter).toHaveBeenCalledOnce();
    expect(adapter.mock.calls[0]?.[0]).toMatchObject({ subject: 'Your Monthly Money Story', to: { email: 'user@example.com' } });

    // Retry with a persisted snapshot (e.g. a prior attempt that rendered but failed before the adapter call) must reuse the stored render rather than invoking the render callback again.
    const retryRender = vi.fn();
    const retryAdapter = vi.fn().mockResolvedValue({ providerMessageIds: ['monthly-provider-retry'], type: 'accepted' });
    const retryReservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue({ rendered }),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveMonthly: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ms:m:202607', newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot })),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const retryService = new FinancialEmailOrchestrationService(retryReservations as unknown as FinancialOrchestrationReservations, rendering, retryAdapter, () => false);
    await expect(retryService.deliverMonthlyStory({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, language: SupportedLanguages.PT, month: 7, recipient: 'user@example.com', render: retryRender, year: 2026 })).resolves.toEqual({ result: 'accepted' });
    expect(retryRender).not.toHaveBeenCalled();
    expect(retryAdapter.mock.calls[0]?.[0]).toMatchObject({ subject: 'Your Monthly Money Story', to: { email: 'user@example.com' } });
  });

  // No "no_facts" case: deliverMonthlyStory always calls `this.preflight(input, 1)` (like deliverWeekly), so the
  // factCount === 0 branch in `preflight` is unreachable here — a zero-driver month is filtered upstream by Task 11's
  // insufficient-data branch (MonthlyStoryInsufficientResult) before the caller ever invokes deliverMonthlyStory.

  it('suppresses interception before rendering, reservation, or adapter use', async () => {
    const reservations = { loadRetrySnapshot: vi.fn(), reserveBudget: vi.fn() };
    const adapter = vi.fn();
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => true);
    await expect(service.deliverBudget({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, facts: [budgetFact], language: SupportedLanguages.PT, localDate: '2026-07-18', recipient: 'user@example.com' })).resolves.toEqual({ reason: 'interception_enabled', result: 'suppressed' });
    expect(reservations.loadRetrySnapshot).not.toHaveBeenCalled();
    expect(reservations.reserveBudget).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it('reuses a stored retry snapshot without rendering or adding facts', async () => {
    const stored = {
      crossings: [{ budgetKey: 2, budgetTemplateCategoryKey: 3, month: 7, tenantKey: 1, threshold: 80, year: 2026 }],
      rendered: { headers: { saved: 'true' }, html: '<p>saved</p>', subject: 'Saved', text: 'saved' },
    };
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(stored),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveBudget: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ba:d:20260718', newlyAcquiredCrossingKeys: stored.crossings.map(() => 'ba:c:1:2:3:202607:80'), result: 'reserved', snapshot })),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'accepted' }),
    };
    const fakeRendering = { renderBudget: vi.fn() };
    const adapter = vi.fn().mockResolvedValue({ providerMessageIds: ['saved-id'], type: 'accepted' });
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, fakeRendering as unknown as FinancialOrchestrationRendering, adapter, () => false);
    await service.deliverBudget({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, facts: [budgetFact, { ...budgetFact, budgetKey: 99 }], language: SupportedLanguages.PT, localDate: '2026-07-18', recipient: 'user@example.com' });
    expect(fakeRendering.renderBudget).not.toHaveBeenCalled();
    expect(reservations.reserveBudget.mock.calls[0]?.[0].crossings).toEqual(stored.crossings);
    expect(adapter).toHaveBeenCalledWith({ ...stored.rendered, to: { email: 'user@example.com' } });
  });

  it.each([
    ['throw', vi.fn().mockRejectedValue(new Error('adapter crash'))],
    ['intercepted', vi.fn().mockResolvedValue({ type: 'intercepted' })],
  ])('quarantines post-reservation adapter %s as unknown', async (_label, adapter) => {
    const snapshot = { rendered: { headers: { saved: 'true' }, html: '<p>saved</p>', subject: 'Saved', text: 'saved' }, weeklyFacts: {} };
    const reservations = {
      loadRetrySnapshot: vi.fn().mockResolvedValue(snapshot),
      recordProviderStart: vi.fn().mockResolvedValue(true),
      reserveWeekly: vi.fn().mockResolvedValue({ deliveryKey: 'wi:w:2026-W29', newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot }),
      transitionOutcome: vi.fn().mockResolvedValue({ result: 'unknown' }),
    };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, rendering, adapter, () => false);
    await expect(service.deliverWeekly({ appuserKey: 7, currencyCode: 'EUR', deliverySupported: true, effectivelyEnabled: true, facts: { activeBudgetStatus: null, comparisonPercentage: null, comparisonWeekTotal: null, isoWeek: 29, isoWeekYear: 2026, subjectWeekTotal: '1', topCategory: { amount: '1', categoryKey: 1, displayName: 'X' } }, isoWeek: 29, isoWeekYear: 2026, language: SupportedLanguages.PT, recipient: 'user@example.com', subjectWeek: { end: new Date('2026-07-12T23:00:00Z'), start: new Date('2026-07-05T23:00:00Z') } })).resolves.toEqual({ result: 'unknown' });
    expect(reservations.transitionOutcome).toHaveBeenCalledWith(7, 'wi:w:2026-W29', { type: 'unknown' });
  });

  it('moves claims to an explicit recoverable state when rendering fails after reservation', async () => {
    const reservations = {
      failBeforeProvider: vi.fn(),
      loadRetrySnapshot: vi.fn().mockResolvedValue(null),
      reserveBudget: vi.fn().mockImplementation(({ snapshot }) => Promise.resolve({ deliveryKey: 'ba:d:20260718', newlyAcquiredCrossingKeys: ['ba:c:1:2:3:202607:100'], result: 'reserved', snapshot })),
    };
    const failingRendering = { renderBudget: vi.fn().mockRejectedValue(new Error('render failed')) };
    const service = new FinancialEmailOrchestrationService(reservations as unknown as FinancialOrchestrationReservations, failingRendering as unknown as FinancialOrchestrationRendering, vi.fn(), () => false);
    await expect(service.deliverBudget({ appuserKey: 7, deliverySupported: true, effectivelyEnabled: true, facts: [budgetFact], language: SupportedLanguages.PT, localDate: '2026-07-18', recipient: 'user@example.com' })).resolves.toEqual({ reason: 'render_failed', result: 'suppressed' });
    expect(reservations.failBeforeProvider).toHaveBeenCalledWith(7, 'ba:d:20260718', 'render_failed');
  });
});
