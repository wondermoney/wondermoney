import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MonthlyStoryFacts } from '@service/budget/aggregation-types';

import { MonthlyStoryNarrativeService } from '../monthly-story-narrative.service';

const tokens = { completionTokens: 1, promptTokens: 2, totalTokens: 3 };

describe('MonthlyStoryNarrativeService', () => {
  const completeJson = vi.fn();
  const service = new MonthlyStoryNarrativeService({ completeJson });

  beforeEach(() => vi.clearAllMocks());

  // The real skeleton sentence for `factsWithOneDriver()` carries both the delta (420.00) and
  // the subject total (1820.00) — see `spendingMoreExpensive` in monthly-story-narrative-skeleton.ts
  // — so a guardrail-passing polished sentence must preserve both numbers, not just the delta.
  it('returns the LLM-polished sentences when the guardrail passes', async () => {
    completeJson.mockResolvedValue({ object: { sentences: ['Julho de 2026 foi 420,00 € mais caro do que o habitual, tendo gasto 1.820,00 € no total.'] }, tokens });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result).toMatchObject({ source: 'llm' });
  });

  it('falls back to the deterministic skeleton when the guardrail rejects a mismatched number', async () => {
    completeJson.mockResolvedValue({ object: { sentences: ['Julho foi 999,00 € mais caro do que o habitual, tendo gasto 1.820,00 € no total.'] }, tokens });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('falls back to the deterministic skeleton when the LLM call throws', async () => {
    completeJson.mockRejectedValue(new Error('timeout'));
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('falls back to the deterministic skeleton when the LLM returns a malformed object', async () => {
    completeJson.mockResolvedValue({ object: { sentences: 'not an array' }, tokens });
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.source).toBe('skeleton');
  });

  it('returns the deterministic skeleton without calling the model when AI is hidden', async () => {
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt', { allowModel: false });

    expect(completeJson).not.toHaveBeenCalled();
    expect(result.source).toBe('skeleton');
    expect(result.sentences.length).toBeGreaterThan(0);
  });

  it('never returns an empty sentence list even on total LLM failure', async () => {
    completeJson.mockRejectedValue(new Error('boom'));
    const result = await service.generate(factsWithOneDriver(), null, 'julho de 2026', 'pt');
    expect(result.sentences.length).toBeGreaterThan(0);
  });

  it.each([['en', 'English'], ['pt', 'European Portuguese'], ['es', 'Spanish']] as const)('asks the model to polish a %s story in %s', async (language, name) => {
    completeJson.mockRejectedValue(new Error('boom'));
    await service.generate(factsWithOneDriver(), null, 'julio de 2026', language);
    expect(completeJson.mock.calls[0]?.[0].user).toContain(`Respond in ${name}.`);
  });

  it('produces the Spanish skeleton fallback when language is es', async () => {
    completeJson.mockRejectedValue(new Error('boom'));
    const result = await service.generate(factsWithOneDriver(), null, 'julio de 2026', 'es');
    expect(result).toEqual({ sentences: ['En julio de 2026 gastaste 420.00 € más de lo habitual: 1820.00 € en total.'], source: 'skeleton' });
  });

  it('produces the English skeleton fallback when language is en', async () => {
    completeJson.mockRejectedValue(new Error('boom'));
    const result = await service.generate(factsWithOneDriver(), null, 'July 2026', 'en');
    expect(result.sentences[0]).toContain('more expensive');
  });
});

function factsWithOneDriver(): MonthlyStoryFacts {
  return { budgetPressure: null, categoryDeltas: [], incomeBaseline: '2000', incomeSubject: '2000', recurringChanges: [], savingsRateBaseline: null, savingsRateSubject: null, spendingBaseline: '1400', spendingSubject: '1820' };
}
