import { describe, expect, it } from 'vitest';

import { extractNumericValues, guardrailPasses } from '../monthly-story-narrative-guardrail';

describe('extractNumericValues', () => {
  it('extracts a plain number', () => {
    expect(extractNumericValues('28%')).toEqual([28]);
  });

  it('extracts a currency amount with thousands separator and decimal comma (pt-PT)', () => {
    expect(extractNumericValues('420,50 €')).toEqual([420.5]);
  });

  it('extracts a currency amount with thousands separator (dot) and decimal comma', () => {
    expect(extractNumericValues('1.234,50 €')).toEqual([1234.5]);
  });

  it('extracts multiple numbers from one sentence', () => {
    expect(extractNumericValues('subiu de 28% para 19%')).toEqual([28, 19]);
  });

  it('extracts an integer with no separator at all', () => {
    expect(extractNumericValues('100')).toEqual([100]);
  });

  it('extracts a large plain-decimal amount with no thousands separator (formatEur\'s actual output shape)', () => {
    // `formatEur` in monthly-story-narrative-skeleton.ts always emits `Big#toFixed(2)`, which is
    // a plain dot-decimal string with NO thousands grouping (e.g. "1234.56", not "1,234.56").
    // A naive digit-grouping regex that caps the leading run at 3 digits (as if a thousands
    // separator were always present) would wrongly split this into two numbers ("123" and
    // "4.56") instead of recognizing the single value 1234.56 — this is the guardrail's most
    // important real-world case, since it is exactly what the deterministic input skeleton
    // produces for any amount >= 1000.
    expect(extractNumericValues('1234.56 €')).toEqual([1234.56]);
  });

  it('extracts a percentage with one decimal digit (pt-PT comma)', () => {
    expect(extractNumericValues('19,5%')).toEqual([19.5]);
  });

  it('extracts a percentage with one decimal digit (en dot)', () => {
    expect(extractNumericValues('19.5%')).toEqual([19.5]);
  });

  it('drops a leading minus sign, extracting the magnitude only', () => {
    // The guardrail compares magnitudes, not signed values — a sign flip in the LLM's wording
    // (e.g. rephrasing a decrease as "-50 €" instead of "50 € less") is not something this
    // numeric guardrail is designed to catch; it only guards against altered/added/dropped
    // figures. See task-14-report.md for this as a documented scope boundary.
    expect(extractNumericValues('-50 €')).toEqual([50]);
  });

  it('returns an empty array when there are no numbers', () => {
    expect(extractNumericValues('sem números aqui')).toEqual([]);
  });

  it('resolves a repeated thousands separator with no decimal part (pt-PT, all dots)', () => {
    // A decimal point can appear at most once in a well-formed number, so when the SAME
    // separator character repeats, it must be thousands grouping, never a decimal — this must
    // resolve to the whole number 12345678, not a truncated/fractional value.
    expect(extractNumericValues('12.345.678')).toEqual([12345678]);
  });

  it('resolves a repeated thousands separator with no decimal part (en, all commas)', () => {
    expect(extractNumericValues('12,345,678')).toEqual([12345678]);
  });

  it('documents the ambiguous lone-separator case: "1.234" is read as a decimal (1.234), not as pt-PT thousands-grouping (1234)', () => {
    // Genuinely ambiguous without locale context — see the doc comment on extractNumericValues
    // for why this function deliberately resolves it this way (fails the guardrail closed rather
    // than open) instead of guessing based on locale.
    expect(extractNumericValues('1.234')).toEqual([1.234]);
  });
});

describe('guardrailPasses', () => {
  it('passes when values match despite reformatting (€420 -> 420 euros, 28% -> 28.0%)', () => {
    expect(guardrailPasses(['A tua taxa de poupança desceu de 28% para 19%.'], ['A tua taxa de poupança desceu de 28,0% para 19,0%.'])).toBe(true);
  });

  it('fails when a number is altered', () => {
    expect(guardrailPasses(['Julho foi 420,00 € mais caro do que o habitual.'], ['Julho foi 450,00 € mais caro do que o habitual.'])).toBe(false);
  });

  it('fails when a number is dropped', () => {
    expect(
      guardrailPasses(
        ['Viagens e Restaurantes explicam a maior parte da subida.', 'A tua taxa de poupança desceu de 28% para 19%.'],
        ['Viagens e Restaurantes explicam a maior parte da subida.'],
      ),
    ).toBe(false);
  });

  it('fails when a number is added that was not in the input', () => {
    expect(guardrailPasses(['Julho foi 420,00 € mais caro do que o habitual.'], ['Julho foi 420,00 € mais caro do que o habitual, cerca de 15% acima.'])).toBe(false);
  });

  it('tolerates tiny rounding noise within epsilon', () => {
    expect(guardrailPasses(['28,00%'], ['28,001%'])).toBe(true);
  });

  it('passes when a large amount is reformatted from plain-decimal to pt-PT grouped notation', () => {
    // Regression test tied directly to the formatEur-shaped bug documented above: the
    // deterministic skeleton emits "1234.56 €" (no thousands grouping); the LLM's pt-PT polish
    // may legitimately reformat that to "1.234,56 €". Same value, must still pass.
    expect(guardrailPasses(['O teu património aumentou 1234.56 € este mês.'], ['O teu património aumentou 1.234,56 € este mês.'])).toBe(true);
  });

  it('fails a full 1-cent difference at the EPSILON boundary', () => {
    // A currency amount altered by exactly one cent (the smallest unit currency actually carries)
    // must not pass the guardrail; with EPSILON at 0.005 a full 1-cent alteration is caught.
    expect(guardrailPasses(['420,00 €'], ['420,01 €'])).toBe(false);
  });

  it('still tolerates the brief-specified 0.001 rounding noise with 5x margin at EPSILON = 0.005', () => {
    expect(guardrailPasses(['28,00%'], ['28,001%'])).toBe(true);
  });
});
