import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MonthlyStoryFacts } from '@service/budget/aggregation-types';

import { MonthlyStoryNarrativeService } from '../monthly-story-narrative.service';

describe('MonthlyStoryNarrativeService', () => {
  const promptWithText = vi.fn();
  const service = new MonthlyStoryNarrativeService({ promptWithText });

  beforeEach(() => vi.clearAllMocks());

  // The real skeleton sentence for `factsWithOneDriver()` carries both the delta (420.00) and
  // the subject total (1820.00) — see `spendingMoreExpensive` in monthly-story-narrative-skeleton.ts
  // — so a guardrail-passing polished sentence must preserve both numbers, not just the delta.
  it('returns the LLM-polished sentences when the guardrail passes', async () => {
    promptWithText.mockResolvedValue({ answer: JSON.stringify({ sentences: ['Julho de 2026 foi 420,00 € mais caro do que o habitual, tendo gasto 1.820,00 € no total.'] }) });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result).toMatchObject({ source: 'llm' });
  });

  it('falls back to the deterministic skeleton when the guardrail rejects a mismatched number', async () => {
    promptWithText.mockResolvedValue({ answer: JSON.stringify({ sentences: ['Julho foi 999,00 € mais caro do que o habitual, tendo gasto 1.820,00 € no total.'] }) });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('falls back to the deterministic skeleton when the LLM call throws', async () => {
    promptWithText.mockRejectedValue(new Error('timeout'));
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('falls back to the deterministic skeleton when the LLM returns malformed JSON', async () => {
    promptWithText.mockResolvedValue({ answer: 'not json' });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('never returns an empty sentence list even on total LLM failure', async () => {
    promptWithText.mockRejectedValue(new Error('boom'));
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.sentences.length).toBeGreaterThan(0);
  });

  it('produces the English skeleton fallback when language is en', async () => {
    promptWithText.mockRejectedValue(new Error('boom'));
    const result = await service.generate(factsWithOneDriver(), null, 'July 2026', 'en');
    expect(result.sentences[0]).toContain('more expensive');
  });
});

function factsWithOneDriver(): MonthlyStoryFacts {
  return { budgetPressure: null, categoryDeltas: [], incomeBaseline: '2000', incomeSubject: '2000', recurringChanges: [], savingsRateBaseline: null, savingsRateSubject: null, spendingBaseline: '1400', spendingSubject: '1820' };
}
