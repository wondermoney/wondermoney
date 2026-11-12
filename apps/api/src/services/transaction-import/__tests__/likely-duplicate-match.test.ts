import { describe, expect, it } from 'vitest';

import { type LikelyDuplicateCandidate, type LikelyDuplicateRow, matchLikelyDuplicates, merchantSimilarity } from '../likely-duplicate-match';

/*
 * Whether a file row repeats a transaction the account already holds: the same signed amount and
 * currency within three days either side, one transaction per row, and never a guess between
 * several.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (over: Partial<LikelyDuplicateRow> & { sourceRow: number }): LikelyDuplicateRow => ({ amount: -4.2, currency: 'EUR', date: '2026-09-10T00:00:00.000Z', name: 'Cafe Boavista', ...over });
const held = (over: Partial<LikelyDuplicateCandidate> & { transactionKey: number }): LikelyDuplicateCandidate => ({ amounts: [-4.2], currency: 'EUR', date: day('2026-09-10'), name: 'CAFE BOAVISTA', ...over });
const outcomeOf = (rows: LikelyDuplicateRow[], candidates: LikelyDuplicateCandidate[], claimed?: number[]) => Object.fromEntries(matchLikelyDuplicates(rows, candidates, { claimed }));

describe('matchLikelyDuplicates', () => {
  it.each([
    { candidate: day('2026-09-07'), expected: 'match', label: '3 days before' },
    { candidate: day('2026-09-13'), expected: 'match', label: '3 days after' },
    { candidate: new Date('2026-09-13T23:59:00.000Z'), expected: 'match', label: 'late on the third day after' },
    { candidate: day('2026-09-06'), expected: 'none', label: '4 days before' },
    { candidate: day('2026-09-14'), expected: 'none', label: '4 days after' },
    { candidate: day('2026-09-11'), expected: 'match', label: 'the next day' },
    { candidate: null, expected: 'none', label: 'no date' },
  ])('matches within three calendar days either side, inclusive: $label is $expected', ({ candidate, expected }) => {
    expect(outcomeOf([row({ sourceRow: 1 })], [held({ date: candidate, transactionKey: 7 })])[1]?.status).toBe(expected);
  });

  it.each([
    { amounts: [-4.2], currency: 'EUR', expected: 'match', label: 'the same amount and currency' },
    { amounts: [-4.2001], currency: 'EUR', expected: 'match', label: 'the same amount to the cent' },
    { amounts: [-4.21], currency: 'EUR', expected: 'none', label: 'a cent apart' },
    { amounts: [4.2], currency: 'EUR', expected: 'none', label: 'the opposite sign' },
    { amounts: [-4.2], currency: 'USD', expected: 'none', label: 'another currency' },
    { amounts: [-4.2], currency: null, expected: 'none', label: 'no currency' },
    { amounts: [-5, -4.2], currency: 'EUR', expected: 'match', label: 'the amount the person edited it to' },
  ])('needs the same signed amount and currency: $label is $expected', ({ amounts, currency, expected }) => {
    expect(outcomeOf([row({ sourceRow: 1 })], [held({ amounts, currency, transactionKey: 7 })])[1]?.status).toBe(expected);
  });

  it('matches a single candidate whatever its description says, for the person to judge', () => {
    expect(outcomeOf([row({ name: 'Groceries', sourceRow: 1 })], [held({ name: 'TRF MB WAY 4412', transactionKey: 7 })])).toEqual({ 1: { status: 'match', transactionKey: 7 } });
  });

  it('calls a row with several candidates ambiguous, naming them, and claims none of them', () => {
    const outcome = outcomeOf([row({ name: null, sourceRow: 1 })], [held({ transactionKey: 7 }), held({ date: day('2026-09-12'), transactionKey: 8 })]);
    expect(outcome).toEqual({ 1: { candidates: [7, 8], status: 'ambiguous' } });
  });

  it('picks, among several candidates, the only one that names the same merchant', () => {
    const outcome = outcomeOf([row({ name: 'Continente', sourceRow: 1 })], [held({ name: 'PINGO DOCE', transactionKey: 7 }), held({ name: 'COMPRA 4412 CONTINENTE MATOSINHOS', transactionKey: 8 })]);
    expect(outcome).toEqual({ 1: { status: 'match', transactionKey: 8 } });
  });

  it('stays ambiguous when two candidates name the same merchant', () => {
    expect(outcomeOf([row({ sourceRow: 1 })], [held({ transactionKey: 7 }), held({ transactionKey: 8 })])[1]).toEqual({ candidates: [7, 8], status: 'ambiguous' });
  });

  it('lets one transaction be claimed by one row only: two identical coffees in the file against one in the account', () => {
    expect(outcomeOf([row({ sourceRow: 2 }), row({ sourceRow: 1 })], [held({ transactionKey: 7 })])).toEqual({ 1: { status: 'match', transactionKey: 7 }, 2: { status: 'none' } });
  });

  it('gives a contested transaction to the closer row, whatever the file order', () => {
    const rows = [row({ date: '2026-09-07T00:00:00.000Z', sourceRow: 1 }), row({ date: '2026-09-10T00:00:00.000Z', sourceRow: 2 })];
    expect(outcomeOf(rows, [held({ transactionKey: 7 })])).toEqual({ 1: { status: 'none' }, 2: { status: 'match', transactionKey: 7 } });
  });

  it('settles claims in rounds: a row left with one candidate after another row claimed the other matches it', () => {
    // Row 1 (10 Sept) reaches both transactions; row 2 (13 Sept) reaches only transaction 8.
    const rows = [row({ name: null, sourceRow: 1 }), row({ date: '2026-09-13T00:00:00.000Z', name: null, sourceRow: 2 })];
    const candidates = [held({ date: day('2026-09-09'), transactionKey: 7 }), held({ date: day('2026-09-13'), transactionKey: 8 })];
    expect(outcomeOf(rows, candidates)).toEqual({ 1: { status: 'match', transactionKey: 7 }, 2: { status: 'match', transactionKey: 8 } });
  });

  it('leaves out transactions an exact match already claimed', () => {
    expect(outcomeOf([row({ sourceRow: 1 })], [held({ transactionKey: 7 })], [7])).toEqual({ 1: { status: 'none' } });
    expect(outcomeOf([row({ name: null, sourceRow: 1 })], [held({ transactionKey: 7 }), held({ transactionKey: 8 })], [7])).toEqual({ 1: { status: 'match', transactionKey: 8 } });
  });

  it('gives the same outcome however the rows and candidates are ordered', () => {
    const rows = [row({ sourceRow: 1 }), row({ sourceRow: 2 }), row({ name: null, sourceRow: 3 })];
    const candidates = [held({ transactionKey: 7 }), held({ date: day('2026-09-11'), transactionKey: 8 })];
    expect(outcomeOf([...rows].reverse(), [...candidates].reverse())).toEqual(outcomeOf(rows, candidates));
  });
});

describe('merchantSimilarity', () => {
  it.each([
    { a: 'Continente', b: 'COMPRA 4412 CONTINENTE MATOSINHOS', expected: 1 },
    { a: 'SQ *BLUE BOTTLE COFFEE', b: 'Blue Bottle', expected: 1 },
    { a: 'Netflix', b: 'Spotify', expected: 0 },
    { a: 'Uber Eats', b: 'UBER TRIP', expected: 0.5 },
    { a: 'CARD PAYMENT 1234', b: 'Netflix', expected: null },
    { a: '', b: 'Netflix', expected: null },
  ])('$a and $b: $expected', ({ a, b, expected }) => {
    expect(merchantSimilarity(a, b)).toBe(expected);
  });
});
