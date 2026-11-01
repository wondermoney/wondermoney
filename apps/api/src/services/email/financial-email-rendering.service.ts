import { renderBudgetThresholdAlert, renderMonthlyStory, renderWeeklyInsights } from '@wondermoney/react-email';
import type { BudgetThresholdItem } from '@wondermoney/react-email';

import { instanceName } from '@config/instance-name';
import { SupportedLanguages } from '@entity/Appuser';
import type { BudgetThresholdFact, MonthlyStoryFacts, WeeklyInsightFacts } from '@service/budget/aggregation-types';
import type { RenderedEmailInput, RenderedEmailOutcome } from '@service/email/email';
import { EmailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { BACKEND_URL, FRONTEND_URL, privacyPolicyUrl } from '@utils/constants';

export interface FinancialRendererDeps {
  budgetRenderer?: typeof renderBudgetThresholdAlert;
  monthlyStoryRenderer?: typeof renderMonthlyStory;
  optOutService?: EmailGlobalOptOutService;
  weeklyRenderer?: typeof renderWeeklyInsights;
}

export type RenderedEmailAdapter = (input: RenderedEmailInput) => Promise<RenderedEmailOutcome>;

/** The financial emails ship in EN and PT; everything else falls back to EN. */
type FinancialLanguage = SupportedLanguages;

/** react-email template language + the frontend/docs URL locale segment. */
const renderLang = (language: FinancialLanguage): 'en' | 'pt' => (language === SupportedLanguages.PT ? 'pt' : 'en');
/** Intl locale used for money/percentage/date formatting. */
const intlLocale = (language: FinancialLanguage): string => (language === SupportedLanguages.PT ? 'pt-PT' : 'en-GB');

const COPY = {
  [SupportedLanguages.EN]: {
    above: 'above',
    below: 'below',
    budgetPressure: {
      near: { detail: "You're close to your budget limits this month.", status: 'Close to budget' },
      over: { detail: 'You went over budget in one or more categories this month.', status: 'Over budget' },
    },
    comparisonText: 'Compared to the previous week',
    dataContext: 'Based on the transactions currently available.',
    noChange: 'no change',
  },
  [SupportedLanguages.PT]: {
    above: 'acima',
    below: 'abaixo',
    budgetPressure: {
      near: { detail: 'Estás perto dos limites do orçamento este mês.', status: 'Perto do orçamento' },
      over: { detail: 'Ultrapassaste o orçamento numa ou mais categorias este mês.', status: 'Acima do orçamento' },
    },
    comparisonText: 'Comparação com a semana anterior',
    dataContext: 'Com base nas transações atualmente disponíveis.',
    noChange: 'sem alteração',
  },
} as const;


export class FinancialEmailRenderingService {
  private readonly budgetRenderer: typeof renderBudgetThresholdAlert;
  private readonly monthlyStoryRenderer: typeof renderMonthlyStory;
  private readonly optOutService: EmailGlobalOptOutService;
  private readonly weeklyRenderer: typeof renderWeeklyInsights;

  constructor(deps: FinancialRendererDeps = {}) {
    this.budgetRenderer = deps.budgetRenderer ?? renderBudgetThresholdAlert;
    this.monthlyStoryRenderer = deps.monthlyStoryRenderer ?? renderMonthlyStory;
    this.optOutService = deps.optOutService ?? new EmailGlobalOptOutService();
    this.weeklyRenderer = deps.weeklyRenderer ?? renderWeeklyInsights;
  }

  async renderBudget(input: { appuserKey: number; facts: BudgetThresholdFact[]; firstName?: string; language: FinancialLanguage; recipient: string }): Promise<RenderedEmailInput> {
    const frontendUrl = FRONTEND_URL;
    const lang = renderLang(input.language);
    const locale = intlLocale(input.language);
    const unsubscribeUrl = this.unsubscribeUrl(input.appuserKey);
    const rendered = await this.budgetRenderer({
      brandName: instanceName(),
      ctaUrl: `${frontendUrl}/${lang}/budgets`,
      firstName: input.firstName,
      items: input.facts.map((fact): BudgetThresholdItem => {
        const values = {
          budgetName: fact.budgetName,
          categoryName: fact.categoryName,
          formattedBudgeted: formatMoney(fact.amountBudgeted, fact.currencyCode, locale),
          formattedPercentageUsed: formatPercentage(fact.actualPercentage, locale),
          formattedRemainingOrOver: formatMoney(fact.remainingOrOverAmount, fact.currencyCode, locale),
          formattedSpent: formatMoney(fact.amountSpent, fact.currencyCode, locale),
        };
        if (fact.state === 'near') return { ...values, state: 'near', threshold: 80 };
        return { ...values, state: fact.state, threshold: 100 };
      }),
      language: lang,
      periodLabel: formatMonthYear(input.facts[0]?.month, input.facts[0]?.year, locale),
      privacyUrl: privacyPolicyUrl(lang),
      settingsUrl: `${frontendUrl}/${lang}/settings?tab=notifications`,
      unsubscribeUrl,
      utmCampaign: 'budget_alert',
      utmMedium: 'email',
      utmSource: 'financial_notification',
    });
    return renderedInput(input.recipient, rendered, unsubscribeUrl);
  }

  async renderMonthlyStory(input: { appuserKey: number; currencyCode: string; facts: MonthlyStoryFacts; firstName?: string; language: FinancialLanguage; monthLabel: string; narrativeSentences: string[]; netWorth: null | { subject: string; tone: 'negative' | 'neutral' | 'positive' }; recipient: string }): Promise<RenderedEmailInput> {
    const frontendUrl = FRONTEND_URL;
    const lang = renderLang(input.language);
    const locale = intlLocale(input.language);
    const unsubscribeUrl = this.unsubscribeUrl(input.appuserKey);
    // Only surface the budget-pressure panel when there's something worth flagging (over/near) —
    // `within_plan`, like `null`, conveys "nothing to flag" and is treated the same as absent,
    // mirroring renderBudget/BudgetThresholdAlert, which never fires an "on track" alert either.
    const budgetPressureCopy = input.facts.budgetPressure === 'over' || input.facts.budgetPressure === 'near' ? COPY[input.language].budgetPressure[input.facts.budgetPressure] : undefined;
    const rendered = await this.monthlyStoryRenderer({
      brandName: instanceName(),
      budgetPressureDetail: budgetPressureCopy?.detail,
      budgetPressureStatus: budgetPressureCopy?.status,
      categoryDeltas: input.facts.categoryDeltas.map((delta) => ({
        categoryName: delta.displayName,
        direction: delta.direction,
        formattedBaselineAmount: formatMoney(delta.baselineAmount, input.currencyCode, locale),
        formattedDelta: formatMoney(String(Math.abs(Number(delta.subjectAmount) - Number(delta.baselineAmount))), input.currencyCode, locale),
        formattedSubjectAmount: formatMoney(delta.subjectAmount, input.currencyCode, locale),
      })),
      ctaUrl: `${frontendUrl}/${lang}/reports`,
      firstName: input.firstName,
      formattedIncomeBaseline: formatMoney(input.facts.incomeBaseline, input.currencyCode, locale),
      formattedIncomeSubject: formatMoney(input.facts.incomeSubject, input.currencyCode, locale),
      formattedSpendingBaseline: formatMoney(input.facts.spendingBaseline, input.currencyCode, locale),
      formattedSpendingSubject: formatMoney(input.facts.spendingSubject, input.currencyCode, locale),
      language: lang,
      monthLabel: input.monthLabel,
      narrativeSentences: input.narrativeSentences,
      netWorthMetric: input.netWorth ? { formattedValue: formatMoney(input.netWorth.subject, input.currencyCode, locale), label: '', tone: input.netWorth.tone } : undefined,
      privacyUrl: privacyPolicyUrl(lang),
      recurringChanges: input.facts.recurringChanges.map((change) => ({
        displayName: change.displayName,
        formattedNewAmount: formatMoney(change.newAmount, input.currencyCode, locale),
        formattedPreviousAmount: change.previousAmount ? formatMoney(change.previousAmount, input.currencyCode, locale) : undefined,
        kind: change.kind,
      })),
      // `formattedBaseline` is only set when a baseline exists — `savingsRateBaseline` can be null
      // (baseline-period income was non-positive) even when the subject rate is present; omitting
      // the optional field avoids rendering a literal "null%".
      savingsRateMetric: input.facts.savingsRateSubject != null ? { ...(input.facts.savingsRateBaseline != null ? { formattedBaseline: `${input.facts.savingsRateBaseline}%` } : {}), formattedValue: `${input.facts.savingsRateSubject}%`, label: '', tone: Number(input.facts.savingsRateSubject) >= Number(input.facts.savingsRateBaseline ?? 0) ? 'positive' : 'negative' } : undefined,
      settingsUrl: `${frontendUrl}/${lang}/settings?tab=notifications`,
      status: 'sufficient',
      unsubscribeUrl,
    });
    return renderedInput(input.recipient, rendered, unsubscribeUrl);
  }

  async renderWeekly(input: { appuserKey: number; currencyCode: string; facts: WeeklyInsightFacts; firstName?: string; language: FinancialLanguage; recipient: string; subjectWeek: { end: Date; start: Date } }): Promise<RenderedEmailInput> {
    const frontendUrl = FRONTEND_URL;
    const lang = renderLang(input.language);
    const locale = intlLocale(input.language);
    const unsubscribeUrl = this.unsubscribeUrl(input.appuserKey);
    const previousWeekComparison = formatPreviousWeekComparison(input.facts, input.language);
    const rendered = await this.weeklyRenderer({
      brandName: instanceName(),
      budgetSummary: input.facts.activeBudgetStatus ? { status: input.facts.activeBudgetStatus } : undefined,
      ctaUrl: `${frontendUrl}/${lang}`,
      dataContext: COPY[input.language].dataContext,
      firstName: input.firstName,
      formattedTopCategoryAmount: formatMoney(input.facts.topCategory.amount, input.currencyCode, locale),
      formattedTotalSpending: formatMoney(input.facts.subjectWeekTotal, input.currencyCode, locale),
      language: lang,
      privacyUrl: privacyPolicyUrl(lang),
      ...previousWeekComparison,
      settingsUrl: `${frontendUrl}/${lang}/settings?tab=notifications`,
      topCategoryDisplay: input.facts.topCategory.displayName,
      unsubscribeUrl,
      utmCampaign: 'weekly_insights',
      utmMedium: 'email',
      utmSource: 'financial_notification',
      weekDateRange: formatWeekRange(input.subjectWeek, input.language),
    });
    return renderedInput(input.recipient, rendered, unsubscribeUrl);
  }

  /**
   * Renders the low-data monthly story variant (< 3 months of history, or a
   * subject month with zero activity). Unlike every other renderer in this
   * file, `currencyCode` is optional — the insufficient-data path may run
   * before a tenant's currency context is fully relevant to the message — so
   * it's passed through when available (subject-month totals exist even in
   * the `zero_activity` case) and the metrics panel is omitted entirely when
   * it isn't.
   */
  async renderMonthlyStoryInsufficient(input: { appuserKey: number; currencyCode?: string; firstName?: string; incomeSubject?: string; language: FinancialLanguage; monthLabel: string; monthsAvailable: number; monthsNeeded: number; reason: 'insufficient_history' | 'zero_activity'; recipient: string; spendingSubject?: string }): Promise<RenderedEmailInput> {
    const frontendUrl = FRONTEND_URL;
    const lang = renderLang(input.language);
    const locale = intlLocale(input.language);
    const unsubscribeUrl = this.unsubscribeUrl(input.appuserKey);
    const rendered = await this.monthlyStoryRenderer({
      brandName: instanceName(),
      ctaUrl: `${frontendUrl}/${lang}/reports`,
      firstName: input.firstName,
      formattedIncomeSubject: input.incomeSubject != null && input.currencyCode ? formatMoney(input.incomeSubject, input.currencyCode, locale) : undefined,
      formattedSpendingSubject: input.spendingSubject != null && input.currencyCode ? formatMoney(input.spendingSubject, input.currencyCode, locale) : undefined,
      language: lang,
      monthLabel: input.monthLabel,
      monthsAvailable: input.monthsAvailable,
      monthsNeeded: input.monthsNeeded,
      privacyUrl: privacyPolicyUrl(lang),
      reason: input.reason,
      settingsUrl: `${frontendUrl}/${lang}/settings?tab=notifications`,
      status: 'insufficient',
      unsubscribeUrl,
    });
    return renderedInput(input.recipient, rendered, unsubscribeUrl);
  }

  private unsubscribeUrl(appuserKey: number) {
    const token = this.optOutService.generateToken(appuserKey);
    return `${BACKEND_URL}/v1/marketing/email-opt-out?token=${encodeURIComponent(token)}`;
  }
}

function formatMoney(value: string, currencyCode: string, locale = 'pt-PT') {
  return new Intl.NumberFormat(locale, { currency: currencyCode, currencyDisplay: 'symbol', style: 'currency' }).format(value as unknown as number);
}

function formatMonthYear(month: number | undefined, year: number | undefined, locale = 'pt-PT') {
  if (!month || !year) throw new Error('Budget period is required');
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatPercentage(value: string, locale = 'pt-PT') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 0, style: 'percent' }).format(Number(value) / 100);
}

function formatPreviousWeekComparison(facts: WeeklyInsightFacts, language: FinancialLanguage) {
  if (facts.comparisonPercentage == null || facts.comparisonWeekTotal == null) return {};
  const copy = COPY[language];
  const locale = intlLocale(language);
  const percentage = Number(facts.comparisonPercentage);
  const previousWeekComparisonValue = Object.is(percentage, -0) || percentage === 0
    ? copy.noChange
    : `${formatPercentage(String(Math.abs(percentage)), locale)} ${percentage > 0 ? copy.above : copy.below}`;
  return {
    previousWeekComparisonText: copy.comparisonText,
    previousWeekComparisonValue,
  };
}

function formatWeekRange(range: { end: Date; start: Date }, language: FinancialLanguage) {
  const locale = intlLocale(language);
  const lastDay = new Date(range.end.getTime() - 1);
  const day = (date: Date) => new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'Europe/Lisbon' }).format(date);
  const month = (date: Date) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'Europe/Lisbon' }).format(date);
  const year = (date: Date) => new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Lisbon', year: 'numeric' }).format(date);
  const sameMonth = month(range.start) === month(lastDay) && year(range.start) === year(lastDay);
  const sameYear = year(range.start) === year(lastDay);
  if (language === SupportedLanguages.PT) {
    if (sameMonth) return `${day(range.start)} a ${day(lastDay)} de ${month(lastDay)} de ${year(lastDay)}`;
    if (sameYear) return `${day(range.start)} de ${month(range.start)} a ${day(lastDay)} de ${month(lastDay)} de ${year(lastDay)}`;
    return `${day(range.start)} de ${month(range.start)} de ${year(range.start)} a ${day(lastDay)} de ${month(lastDay)} de ${year(lastDay)}`;
  }
  if (sameMonth) return `${day(range.start)} to ${day(lastDay)} ${month(lastDay)} ${year(lastDay)}`;
  if (sameYear) return `${day(range.start)} ${month(range.start)} to ${day(lastDay)} ${month(lastDay)} ${year(lastDay)}`;
  return `${day(range.start)} ${month(range.start)} ${year(range.start)} to ${day(lastDay)} ${month(lastDay)} ${year(lastDay)}`;
}

function renderedInput(recipient: string, rendered: { html: string; preheader?: string; subject: string; text: string }, unsubscribeUrl: string): RenderedEmailInput {
  return {
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: rendered.html,
    preheader: rendered.preheader,
    subject: rendered.subject,
    text: rendered.text,
    to: { email: recipient },
  };
}
