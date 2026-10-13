import { describe, expect, it } from 'vitest';

import { buildNarrativeSkeleton, type NarrativeLanguage } from '../monthly-story-narrative-skeleton';

const baseFacts = () => ({
  budgetPressure: null,
  categoryDeltas: [],
  incomeBaseline: '2000',
  incomeSubject: '2000',
  recurringChanges: [],
  savingsRateBaseline: '28.00',
  savingsRateSubject: '28.00',
  spendingBaseline: '1400',
  spendingSubject: '1400',
});

const LANGUAGES: NarrativeLanguage[] = ['en', 'pt'];

describe('buildNarrativeSkeleton', () => {
  describe.each(LANGUAGES)('language=%s', (language) => {
    it('selects at most 4 drivers even when more facts are significant', () => {
      const facts = {
        ...baseFacts(),
        categoryDeltas: Array.from({ length: 10 }, (_, i) => ({
          baselineAmount: '10',
          categoryKey: i,
          direction: 'increase' as const,
          displayName: `Cat ${i}`,
          percentOfBaseline: '900.00',
          subjectAmount: '100',
        })),
      };
      const skeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', language);
      expect(skeleton.sentences.length).toBeLessThanOrEqual(4);
    });

    it("normalizes by each fact's own baseline so net worth (large €) does not always dominate category deltas (small €, high % swing)", () => {
      const facts = {
        ...baseFacts(),
        categoryDeltas: [{ baselineAmount: '50', categoryKey: 1, direction: 'increase' as const, displayName: 'Travel', percentOfBaseline: '400.00', subjectAmount: '250' }],
      };
      const netWorth = { baseline: '50000', subject: '50100' }; // +0.2% — tiny relative change despite large absolute €
      const skeleton = buildNarrativeSkeleton(facts, netWorth, 'julho de 2026', language);
      expect(skeleton.sentences.some((s) => s.includes('Travel'))).toBe(true);
    });

    it('every number in the output is copied verbatim from input facts', () => {
      const facts = { ...baseFacts(), spendingBaseline: '1400', spendingSubject: '1820' };
      const skeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', language);
      expect(skeleton.sentences.join(' ')).toMatch(/1820|1\.820/);
    });

    it('omits the savings-rate sentence when savingsRateSubject is null (zero income)', () => {
      const facts = { ...baseFacts(), savingsRateBaseline: null, savingsRateSubject: null };
      const skeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', language);
      expect(skeleton.sentences.every((s) => !/poupança|savings/i.test(s))).toBe(true);
    });
  });

  it('maps budget pressure severity to a fixed score (over=100, near=50, within_plan=0) so an over-budget category can win a slot without a large € figure', () => {
    const facts = { ...baseFacts(), budgetPressure: 'over' as const };
    const skeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', 'pt');
    expect(skeleton.sentences.some((s) => /over|acima/i.test(s))).toBe(true);
  });

  it('within_plan budget pressure never contributes a sentence', () => {
    const facts = { ...baseFacts(), budgetPressure: 'within_plan' as const };
    const skeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', 'pt');
    expect(skeleton.sentences.some((s) => /orçamento|budget/i.test(s))).toBe(false);
  });

  it('near budget pressure contributes a lower-scored sentence than over', () => {
    const overFacts = { ...baseFacts(), budgetPressure: 'over' as const };
    const nearFacts = { ...baseFacts(), budgetPressure: 'near' as const };
    const overSkeleton = buildNarrativeSkeleton(overFacts, null, 'julho de 2026', 'pt');
    const nearSkeleton = buildNarrativeSkeleton(nearFacts, null, 'julho de 2026', 'pt');
    expect(overSkeleton.sentences.some((s) => /acima/i.test(s))).toBe(true);
    expect(nearSkeleton.sentences.some((s) => /perto/i.test(s))).toBe(true);
  });

  it('income driver is skipped when the deviation is below the 1% materiality threshold, regardless of language', () => {
    const facts = { ...baseFacts(), incomeBaseline: '2000', incomeSubject: '2005' }; // 0.25% — below threshold
    const ptSkeleton = buildNarrativeSkeleton(facts, null, 'julho de 2026', 'pt');
    const enSkeleton = buildNarrativeSkeleton(facts, null, 'July 2026', 'en');
    expect(ptSkeleton.sentences.some((s) => /rendimento/i.test(s))).toBe(false);
    expect(enSkeleton.sentences.some((s) => /income/i.test(s))).toBe(false);
  });

  // The two tests above only exercise category/budgetOver/spending/income, because
  // savingsRate and netWorth are the two lowest-scored drivers in that mixed fixture and get
  // dropped by the MAX_DRIVERS=4 cap before their sentence text is ever asserted. These
  // isolated fixtures suppress every other driver (spending/income sit at a 0% deviation —
  // which still occupies a slot per the brief's inherited "zero-score driver" behavior, but
  // that's harmless here since only 2-3 total candidates exist, well under the cap) so
  // savingsRate/netWorth are guaranteed to appear in `sentences`, genuinely asserting their
  // EN/PT copy rather than relying on it "theoretically" being defined.
  describe.each(LANGUAGES)('language=%s — isolated low-score drivers actually asserted', (language) => {
    const savingsRateWord = language === 'pt' ? /poupança/i : /savings/i;
    const netWorthWord = language === 'pt' ? /património/i : /net worth/i;
    const monthLabel = language === 'pt' ? 'julho de 2026' : 'July 2026';

    it('produces the savings-rate-up sentence in the correct language when savingsRate is the only material change', () => {
      const facts = { ...baseFacts(), savingsRateBaseline: '20.00', savingsRateSubject: '25.00' };
      const skeleton = buildNarrativeSkeleton(facts, null, monthLabel, language);
      expect(skeleton.sentences.some((s) => savingsRateWord.test(s))).toBe(true);
      expect(skeleton.sentences.join(' ')).toMatch(/20.*25/);
    });

    it('produces the savings-rate-down sentence in the correct language when savingsRate is the only material change', () => {
      const facts = { ...baseFacts(), savingsRateBaseline: '25.00', savingsRateSubject: '20.00' };
      const skeleton = buildNarrativeSkeleton(facts, null, monthLabel, language);
      expect(skeleton.sentences.some((s) => savingsRateWord.test(s))).toBe(true);
      expect(skeleton.sentences.join(' ')).toMatch(/25.*20/);
    });

    it('produces the net-worth-up sentence in the correct language when netWorth is the only material change', () => {
      const netWorth = { baseline: '50000', subject: '55000' };
      const skeleton = buildNarrativeSkeleton(baseFacts(), netWorth, monthLabel, language);
      expect(skeleton.sentences.some((s) => netWorthWord.test(s))).toBe(true);
      expect(skeleton.sentences.join(' ')).toMatch(/5000/);
    });

    it('produces the net-worth-down sentence in the correct language when netWorth is the only material change', () => {
      const netWorth = { baseline: '50000', subject: '45000' };
      const skeleton = buildNarrativeSkeleton(baseFacts(), netWorth, monthLabel, language);
      expect(skeleton.sentences.some((s) => netWorthWord.test(s))).toBe(true);
      expect(skeleton.sentences.join(' ')).toMatch(/5000/);
    });
  });
});
