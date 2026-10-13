import Big from 'big.js';

import type { MonthlyStoryFacts } from '@service/budget/aggregation-types';

export interface NetWorthDriverInput {
  baseline: null | string;
  subject: string;
}

/**
 * The user's requested delivery language, per `fresh.language` in the eligibility check
 * (Task 15's caller). This skeleton is not just an LLM input — it is also the ungated
 * fallback text shipped verbatim when the LLM polish call fails or is guardrail-rejected,
 * so every driver sentence must exist in both languages. Never add a driver whose sentence
 * is only defined for one language.
 */
export type NarrativeLanguage = 'en' | 'pt';

interface ScoredDriver {
  score: number;
  sentence: string;
}

const MAX_DRIVERS = 4;

// Income moves under 1% of baseline are treated as noise (FX/rounding drift on salary
// deposits), matching the materiality-threshold convention used elsewhere in the
// monthly-story domain (see monthly-story-recurring-changes.ts).
const INCOME_MATERIALITY_THRESHOLD_PERCENT = 1;

const COPY: Record<
  NarrativeLanguage,
  {
    budgetNear: string;
    budgetOver: string;
    categoriesExplain: (names: string, plural: boolean, direction: 'decrease' | 'increase') => string;
    conjunction: string;
    incomeDown: (delta: string) => string;
    incomeUp: (delta: string) => string;
    netWorthDown: (delta: string) => string;
    netWorthUp: (delta: string) => string;
    savingsRateDown: (baseline: string, subject: string) => string;
    savingsRateUp: (baseline: string, subject: string) => string;
    spendingCheaper: (monthLabel: string, delta: string, subjectTotal: string) => string;
    spendingMoreExpensive: (monthLabel: string, delta: string, subjectTotal: string) => string;
  }
> = {
  en: {
    budgetNear: 'Some categories ended up close to their planned budget.',
    budgetOver: 'Some categories went over the planned budget.',
    categoriesExplain: (names, plural, direction) => `${names} ${plural ? 'explain' : 'explains'} most of the ${direction === 'increase' ? 'increase' : 'decrease'}.`,
    conjunction: ' and ',
    incomeDown: (delta) => `Your income was down ${delta} from usual.`,
    incomeUp: (delta) => `Your income was up ${delta} from usual.`,
    netWorthDown: (delta) => `Your net worth decreased by ${delta} this month.`,
    netWorthUp: (delta) => `Your net worth increased by ${delta} this month.`,
    savingsRateDown: (baseline, subject) => `Your savings rate dropped from ${baseline}% to ${subject}%.`,
    savingsRateUp: (baseline, subject) => `Your savings rate rose from ${baseline}% to ${subject}%.`,
    spendingCheaper: (monthLabel, delta, subjectTotal) => `${monthLabel} was ${delta} cheaper than usual — you spent ${subjectTotal} in total.`,
    spendingMoreExpensive: (monthLabel, delta, subjectTotal) => `${monthLabel} was ${delta} more expensive than usual — you spent ${subjectTotal} in total.`,
  },
  pt: {
    budgetNear: 'Algumas categorias ficaram perto do valor definido no orçamento.',
    budgetOver: 'Algumas categorias ficaram acima do orçamento planeado.',
    categoriesExplain: (names, plural, direction) => `${names} ${plural ? 'explicam' : 'explica'} a maior parte da ${direction === 'increase' ? 'subida' : 'descida'}.`,
    conjunction: ' e ',
    incomeDown: (delta) => `O teu rendimento desceu ${delta} face ao habitual.`,
    incomeUp: (delta) => `O teu rendimento subiu ${delta} face ao habitual.`,
    netWorthDown: (delta) => `O teu património diminuiu ${delta} este mês.`,
    netWorthUp: (delta) => `O teu património aumentou ${delta} este mês.`,
    savingsRateDown: (baseline, subject) => `A tua taxa de poupança desceu de ${baseline}% para ${subject}%.`,
    savingsRateUp: (baseline, subject) => `A tua taxa de poupança subiu de ${baseline}% para ${subject}%.`,
    spendingCheaper: (monthLabel, delta, subjectTotal) => `${monthLabel} foi ${delta} mais barato do que o habitual — gastaste ${subjectTotal} no total.`,
    spendingMoreExpensive: (monthLabel, delta, subjectTotal) => `${monthLabel} foi ${delta} mais caro do que o habitual — gastaste ${subjectTotal} no total.`,
  },
};

/**
 * Builds a deterministic "narrative skeleton" — one plain-language sentence per material
 * driver of the month, ranked by a normalized score so incompatible fact types (€ deltas,
 * percentage-point savings-rate swings, categorical budget severity) can compete for the
 * same limited set of slots. Consumed by Task 15's narrative service, which sends the
 * skeleton to an LLM for tone-polish in `language` — and falls back to these sentences
 * verbatim if that call fails or is guardrail-rejected. That fallback path is why `language`
 * is a required parameter here rather than PT-only: a PT-only fallback would silently ship
 * Portuguese text to an English-speaking user whenever the LLM step fails.
 *
 * Drivers are scored by their own relative magnitude (percent deviation from baseline, or a
 * fixed severity score for categorical facts) rather than by absolute €, so a large but
 * relatively small net-worth wobble does not automatically drown out a small but
 * proportionally large category swing.
 */
export function buildNarrativeSkeleton(facts: MonthlyStoryFacts, netWorth: NetWorthDriverInput | null, monthLabel: string, language: NarrativeLanguage): { sentences: string[] } {
  const copy = COPY[language];
  const drivers: ScoredDriver[] = [];

  const spendingDeltaPercent = pctDeviation(facts.spendingBaseline, facts.spendingSubject);
  if (spendingDeltaPercent != null) {
    const isIncrease = spendingDeltaPercent >= 0;
    const delta = isIncrease ? new Big(facts.spendingSubject).minus(facts.spendingBaseline) : new Big(facts.spendingBaseline).minus(facts.spendingSubject);
    drivers.push({
      score: Math.abs(spendingDeltaPercent),
      sentence: isIncrease
        ? copy.spendingMoreExpensive(monthLabel, formatEur(delta), formatEur(new Big(facts.spendingSubject)))
        : copy.spendingCheaper(monthLabel, formatEur(delta), formatEur(new Big(facts.spendingSubject))),
    });
  }

  const incomeDeltaPercent = pctDeviation(facts.incomeBaseline, facts.incomeSubject);
  if (incomeDeltaPercent != null && Math.abs(incomeDeltaPercent) >= INCOME_MATERIALITY_THRESHOLD_PERCENT) {
    const isIncrease = incomeDeltaPercent >= 0;
    const delta = isIncrease ? new Big(facts.incomeSubject).minus(facts.incomeBaseline) : new Big(facts.incomeBaseline).minus(facts.incomeSubject);
    drivers.push({
      score: Math.abs(incomeDeltaPercent),
      sentence: isIncrease ? copy.incomeUp(formatEur(delta)) : copy.incomeDown(formatEur(delta)),
    });
  }

  const topCategories = [...facts.categoryDeltas].slice(0, 2);
  if (topCategories.length > 0) {
    const names = topCategories.map((c) => c.displayName).join(copy.conjunction);
    drivers.push({
      score: Math.max(...topCategories.map((c) => Math.abs(Number(c.percentOfBaseline ?? '0')))),
      sentence: copy.categoriesExplain(names, topCategories.length > 1, topCategories[0]!.direction),
    });
  }

  if (facts.savingsRateSubject != null && facts.savingsRateBaseline != null) {
    const pointsDelta = Number(facts.savingsRateSubject) - Number(facts.savingsRateBaseline);
    drivers.push({
      score: Math.abs(pointsDelta),
      sentence: pointsDelta >= 0 ? copy.savingsRateUp(facts.savingsRateBaseline, facts.savingsRateSubject) : copy.savingsRateDown(facts.savingsRateBaseline, facts.savingsRateSubject),
    });
  }

  if (facts.budgetPressure != null && facts.budgetPressure !== 'within_plan') {
    const severity: Record<'near' | 'over', number> = { near: 50, over: 100 };
    drivers.push({
      score: severity[facts.budgetPressure],
      sentence: facts.budgetPressure === 'over' ? copy.budgetOver : copy.budgetNear,
    });
  }

  if (netWorth?.baseline != null) {
    const netWorthDeltaPercent = pctDeviation(netWorth.baseline, netWorth.subject);
    if (netWorthDeltaPercent != null) {
      const delta = new Big(netWorth.subject).minus(netWorth.baseline);
      drivers.push({
        score: Math.abs(netWorthDeltaPercent),
        sentence: delta.gte(0) ? copy.netWorthUp(formatEur(delta)) : copy.netWorthDown(formatEur(delta.abs())),
      });
    }
  }

  const sentences = drivers
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DRIVERS)
    .map((d) => d.sentence);
  return { sentences };
}

function formatEur(value: Big): string {
  return `${value.toFixed(2)} €`;
}

function pctDeviation(baseline: string, subject: string): null | number {
  const baselineValue = new Big(baseline);
  if (baselineValue.eq(0)) return null;
  return Number(new Big(subject).minus(baselineValue).div(baselineValue).times(100));
}
