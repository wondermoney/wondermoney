import { describe, expect, it } from 'vitest';

import { CERTIFICADO_AFORRO_SERIES_CONSTANTS } from '@service/portfolio/certificado-aforro-calculation.service';

import {
  CERTIFICADO_AFORRO_PREMIUM_SCHEDULES,
  CERTIFICADO_AFORRO_RATE_HISTORY,
} from '../certificado-aforro-reference-data';

/**
 * These constants are hand-curated real-world money data transcribed from IGCP's publications.
 * The suite is a shape/consistency guard, not a re-derivation: it cannot tell you a figure is the
 * right one, but it catches the mistakes a human editing this table actually makes — a duplicated
 * or out-of-order month, a bracket gap or overlap, a rate above the series' legal cap, or C/D
 * quietly acquiring invented data.
 */
describe('CERTIFICADO_AFORRO_PREMIUM_SCHEDULES', () => {
  it('covers exactly the two provisioned series — C and D stay deliberately unprovisioned', () => {
    expect(Object.keys(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES).sort()).toEqual(['CA-SERIE-E', 'CA-SERIE-F']);
  });

  it('matches IGCP\'s published Série E schedule (0.5% yr2-5, 1.0% yr6-10)', () => {
    expect(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES['CA-SERIE-E']).toEqual([
      { cohortStartDate: null, premiumBps: 50, yearFrom: 2, yearTo: 5 },
      { cohortStartDate: null, premiumBps: 100, yearFrom: 6, yearTo: 10 },
    ]);
  });

  it('matches IGCP\'s published Série F schedule (0.25/0.50/1.00/1.50/1.75%)', () => {
    expect(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES['CA-SERIE-F']).toEqual([
      { cohortStartDate: null, premiumBps: 25, yearFrom: 2, yearTo: 5 },
      { cohortStartDate: null, premiumBps: 50, yearFrom: 6, yearTo: 9 },
      { cohortStartDate: null, premiumBps: 100, yearFrom: 10, yearTo: 11 },
      { cohortStartDate: null, premiumBps: 150, yearFrom: 12, yearTo: 13 },
      { cohortStartDate: null, premiumBps: 175, yearFrom: 14, yearTo: 15 },
    ]);
  });

  it.each(Object.entries(CERTIFICADO_AFORRO_PREMIUM_SCHEDULES))(
    '%s brackets are contiguous from year 2 to the series term with no gap or overlap',
    (symbol, brackets) => {
      const termYears = CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol]!.termYears;
      // Year 1 earns no premium in either series, so the table starts at year 2 by design.
      expect(brackets[0]!.yearFrom).toBe(2);
      expect(brackets.at(-1)!.yearTo).toBe(termYears);
      for (const bracket of brackets) {
        expect(bracket.yearTo).not.toBeNull();
        expect(bracket.yearTo!).toBeGreaterThanOrEqual(bracket.yearFrom);
      }
      // Each bracket must start the year after the previous one ends — no gap, no overlap.
      expect(brackets.slice(1).map((bracket) => bracket.yearFrom)).toEqual(brackets.slice(0, -1).map((bracket) => bracket.yearTo! + 1));
    },
  );
});

describe('CERTIFICADO_AFORRO_RATE_HISTORY', () => {
  it('covers exactly the two provisioned series', () => {
    expect(Object.keys(CERTIFICADO_AFORRO_RATE_HISTORY).sort()).toEqual(['CA-SERIE-E', 'CA-SERIE-F']);
  });

  it.each(Object.entries(CERTIFICADO_AFORRO_RATE_HISTORY))('%s months are unique, first-of-month and strictly ascending', (_symbol, periods) => {
    const months = periods.map((period) => period.effectiveMonth);
    expect(new Set(months).size).toBe(months.length);
    expect([...months].sort()).toEqual(months);
    for (const month of months) expect(month).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it.each(Object.entries(CERTIFICADO_AFORRO_RATE_HISTORY))(
    '%s rates are whole bps inside the series\' own legal floor/cap',
    (symbol, periods) => {
      const { capBps, floorBps } = CERTIFICADO_AFORRO_SERIES_CONSTANTS[symbol]!;
      for (const period of periods) {
        expect(Number.isInteger(period.baseRateBps)).toBe(true);
        expect(period.baseRateBps).toBeGreaterThanOrEqual(floorBps);
        // IGCP publishes the already-clamped figure, so a value above the cap means either a
        // transcription slip or a wrong cap constant — both worth failing on.
        expect(period.baseRateBps).toBeLessThanOrEqual(capBps);
      }
    },
  );

  it('starts each series at its real subscription-window opening and runs to the present month', () => {
    // Série E: created by Portaria 329-A/2017 (30 Oct 2017); IGCP's first Série E new-subscription
    // rate announcement is November 2017. Série F: created by Portaria 149-A/2023 (2 Jun 2023),
    // first announced rate June 2023.
    expect(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-E']![0]!.effectiveMonth).toBe('2017-11-01');
    expect(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-F']![0]!.effectiveMonth).toBe('2023-06-01');
    expect(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-E']!.at(-1)!.effectiveMonth).toBe('2026-08-01');
    expect(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-F']!.at(-1)!.effectiveMonth).toBe('2026-08-01');
  });

  it('keeps Série E exactly 100bps above Série F for every month both were published', () => {
    // From July 2023 (E closed to new subscriptions) E's rate is derived as F + 1.00pp — the two
    // formulas and the two caps differ by the same 1.00pp, so the identity is exact, including
    // while F is pinned at its own 2.50% cap. A drift here means the derivation broke.
    const fByMonth = new Map(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-F']!.map((period) => [period.effectiveMonth, period.baseRateBps]));
    const derived = CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-E']!.filter((period) => period.effectiveMonth >= '2023-07-01');
    expect(derived.length).toBeGreaterThan(30);
    for (const period of derived) {
      expect(fByMonth.get(period.effectiveMonth)).toBe(period.baseRateBps - 100);
    }

    // June 2023 is the one month IGCP published BOTH series' new-subscription rates independently
    // (E was closing, F was opening) — 3.500% and 2.500%. That the two land exactly 100bps apart
    // is corroboration of the derivation from IGCP's own figures, not an artefact of our arithmetic.
    expect(CERTIFICADO_AFORRO_RATE_HISTORY['CA-SERIE-E']!.find((p) => p.effectiveMonth === '2023-06-01')?.baseRateBps).toBe(350);
    expect(fByMonth.get('2023-06-01')).toBe(250);
  });

  it('documents the four unrecoverable 2024 months as absent rather than guessed', () => {
    // IGCP purged these from its live site and the Internet Archive has no usable capture. The
    // accrual engine carries the previous month's rate forward (with a warning) across them.
    const missing = ['2024-06-01', '2024-08-01', '2024-10-01', '2024-11-01'];
    for (const [, periods] of Object.entries(CERTIFICADO_AFORRO_RATE_HISTORY)) {
      const months = new Set(periods.map((period) => period.effectiveMonth));
      for (const month of missing) expect(months.has(month)).toBe(false);
    }
  });
});
