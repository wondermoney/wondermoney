import { describe, expect, it, vi } from 'vitest';

import logger from '@utils/logger';

import { CERTIFICADO_AFORRO_SERIES_CONSTANTS, computeCertificateLotValue, IRS_WITHHOLDING_RATE_BPS, resolvePremiumBrackets } from '../certificado-aforro-calculation.service';

/**
 * Every date in this suite is built as a LOCAL midnight so the suite is timezone-independent.
 * That also mirrors production: `node-postgres` parses a `date` column into a local-midnight
 * `Date`, and all the engine's date math (date-fns) works on local calendar fields. Building
 * dates from ISO strings instead (`new Date('2024-04-01')`) would land on a different calendar
 * day in any timezone behind UTC and silently shift quarter boundaries.
 */
const d = (year: number, month: number, day: number): Date => new Date(year, month - 1, day);

describe('CERTIFICADO_AFORRO_SERIES_CONSTANTS', () => {
  it('defines constants for every supported series symbol', () => {
    expect(Object.keys(CERTIFICADO_AFORRO_SERIES_CONSTANTS).sort()).toEqual([
      'CA-SERIE-A',
      'CA-SERIE-B',
      'CA-SERIE-C',
      'CA-SERIE-D',
      'CA-SERIE-E',
      'CA-SERIE-F',
    ]);
  });

  it('defines cap/floor/term for every accrual-mode series (Séries C/D/E/F)', () => {
    for (const constants of Object.values(CERTIFICADO_AFORRO_SERIES_CONSTANTS)) {
      if (constants.valuationMode !== 'accrual') continue;
      expect(constants.capBps).toBeGreaterThan(constants.floorBps);
      expect(constants.floorBps).toBeGreaterThanOrEqual(0);
      expect(constants.termYears).toBeGreaterThan(0);
    }
  });

  it('uses the Portaria 149-A/2023 cap and 15-year term for Série F', () => {
    expect(CERTIFICADO_AFORRO_SERIES_CONSTANTS['CA-SERIE-F']).toEqual({ capBps: 250, floorBps: 0, termYears: 15, valuationMode: 'accrual' });
  });

  it('marks Séries A/B (perpetual, legacy) as static valuation, with meaningless cap/floor/term', () => {
    expect(CERTIFICADO_AFORRO_SERIES_CONSTANTS['CA-SERIE-A']).toEqual({ capBps: 0, floorBps: 0, termYears: 0, valuationMode: 'static' });
    expect(CERTIFICADO_AFORRO_SERIES_CONSTANTS['CA-SERIE-B']).toEqual({ capBps: 0, floorBps: 0, termYears: 0, valuationMode: 'static' });
  });

  it('withholds the flat 28% Portuguese capital-income rate', () => {
    expect(IRS_WITHHOLDING_RATE_BPS).toBe(2800);
  });
});

describe('resolvePremiumBrackets', () => {
  it('returns the standard-cohort brackets when no cohort_start_date matches', () => {
    const schedules = [
      { cohortStartDate: null, premiumBps: 25, yearFrom: 2, yearTo: 5 },
      { cohortStartDate: null, premiumBps: 50, yearFrom: 6, yearTo: null },
    ];
    const brackets = resolvePremiumBrackets(schedules, d(2020, 1, 1));
    expect(brackets).toEqual([
      { premiumBps: 25, yearFrom: 2, yearTo: 5 },
      { premiumBps: 50, yearFrom: 6, yearTo: null },
    ]);
  });

  it('picks the latest cohort whose cohortStartDate is <= subscriptionDate', () => {
    const schedules = [
      { cohortStartDate: null, premiumBps: 10, yearFrom: 1, yearTo: null },
      { cohortStartDate: d(2012, 1, 1), premiumBps: 20, yearFrom: 1, yearTo: null },
      { cohortStartDate: d(2014, 1, 1), premiumBps: 30, yearFrom: 1, yearTo: null },
    ];
    expect(resolvePremiumBrackets(schedules, d(2013, 6, 1))).toEqual([{ premiumBps: 20, yearFrom: 1, yearTo: null }]);
    expect(resolvePremiumBrackets(schedules, d(2015, 1, 1))).toEqual([{ premiumBps: 30, yearFrom: 1, yearTo: null }]);
    expect(resolvePremiumBrackets(schedules, d(2009, 1, 1))).toEqual([{ premiumBps: 10, yearFrom: 1, yearTo: null }]);
  });

  it('treats a subscription made exactly on a cohort start date as inside that cohort', () => {
    const schedules = [
      { cohortStartDate: null, premiumBps: 10, yearFrom: 1, yearTo: null },
      { cohortStartDate: d(2012, 1, 1), premiumBps: 20, yearFrom: 1, yearTo: null },
    ];
    expect(resolvePremiumBrackets(schedules, d(2012, 1, 1))).toEqual([{ premiumBps: 20, yearFrom: 1, yearTo: null }]);
  });

  it('returns the matched cohort\'s brackets sorted by yearFrom, whatever order the rows arrive in', () => {
    const schedules = [
      { cohortStartDate: d(2012, 1, 1), premiumBps: 50, yearFrom: 6, yearTo: null },
      { cohortStartDate: d(2012, 1, 1), premiumBps: 25, yearFrom: 2, yearTo: 5 },
      { cohortStartDate: null, premiumBps: 99, yearFrom: 1, yearTo: null },
    ];
    expect(resolvePremiumBrackets(schedules, d(2013, 1, 1))).toEqual([
      { premiumBps: 25, yearFrom: 2, yearTo: 5 },
      { premiumBps: 50, yearFrom: 6, yearTo: null },
    ]);
  });

  it('throws when no bracket set applies (misconfigured data)', () => {
    const schedules = [{ cohortStartDate: d(2012, 1, 1), premiumBps: 20, yearFrom: 1, yearTo: null }];
    expect(() => resolvePremiumBrackets(schedules, d(2009, 1, 1))).toThrow(/no premium schedule cohort applies/i);
  });
});

describe('computeCertificateLotValue', () => {
  const standardBrackets = [
    { premiumBps: 25, yearFrom: 2, yearTo: 5 },
    { premiumBps: 50, yearFrom: 6, yearTo: null },
  ];

  /** IGCP publishes one base rate per month; a quarter uses the rate of the month it starts in. */
  const quarterlyRatePeriods = (count: number, baseRateBps = 300, startYear = 2024, startMonth = 1) =>
    Array.from({ length: count }, (_, index) => ({ baseRateBps, effectiveMonth: d(startYear, startMonth + index * 3, 1) }));

  it('accrues zero interest for a lot valued on its subscription date', () => {
    const result = computeCertificateLotValue({
      asOfDate: d(2024, 1, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(1),
      subscriptionDate: d(2024, 1, 1),
      taxExempt: false,
    });
    expect(result.accruedValue).toBe(1000);
    expect(result.grossInterest).toBe(0);
    expect(result.netInterest).toBe(0);
    expect(result.quarters).toEqual([]);
  });

  it('does not accrue a quarter that has not fully elapsed', () => {
    // Subscribed 15 Feb, valued 1 Apr: only ~1.5 months in, the first quarter closes on 15 May.
    const result = computeCertificateLotValue({
      asOfDate: d(2024, 4, 1),
      maturityDate: d(2034, 2, 15),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: [{ baseRateBps: 300, effectiveMonth: d(2024, 2, 1) }],
      subscriptionDate: d(2024, 2, 15),
      taxExempt: false,
    });
    expect(result.quarters).toEqual([]);
    expect(result.accruedValue).toBe(1000);
  });

  it('compounds quarterly, net of 28% withholding, for a non-exempt holder', () => {
    // Year 1 (yearsHeld === 1 at every quarter start): no premium bracket applies (they start at year 2).
    // rate = 300bps base + 0bps premium = 300bps/yr -> 0.75%/quarter gross.
    const result = computeCertificateLotValue({
      asOfDate: d(2025, 1, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(4),
      subscriptionDate: d(2024, 1, 1),
      taxExempt: false,
    });
    // Hand-worked (0.75%/quarter gross, 72% of it capitalised):
    // Q1: gross 1000       * 0.0075 = 7.5,        net 5.4,             balance 1005.4
    // Q2: gross 1005.4     * 0.0075 = 7.5405,     net 5.42916,         balance 1010.82916
    // Q3: gross 1010.82916 * 0.0075 = 7.5812187,  net 5.458477464,     balance 1016.287637464
    // Q4: gross 1016.28763 * 0.0075 = 7.62215728, net 5.487953242,     balance 1021.775590706
    expect(result.quarters).toHaveLength(4);
    expect(result.quarters[0]?.rateBps).toBe(300);
    expect(result.quarters[0]?.quarterEnd).toEqual(d(2024, 4, 1));
    expect(result.quarters[0]?.grossInterest).toBeCloseTo(7.5, 10);
    expect(result.quarters[0]?.netInterest).toBeCloseTo(5.4, 10);
    expect(result.quarters[0]?.balance).toBeCloseTo(1005.4, 10);
    expect(result.quarters[1]?.grossInterest).toBeCloseTo(7.5405, 10);
    expect(result.quarters[1]?.balance).toBeCloseTo(1010.82916, 10);
    expect(result.accruedValue).toBeCloseTo(1021.775590706, 8);
    expect(result.grossInterest).toBeCloseTo(30.24387598, 7);
    expect(result.netInterest).toBeCloseTo(result.accruedValue - 1000, 10);
    expect(result.grossInterest).toBeGreaterThan(result.netInterest);
  });

  it('does not withhold tax when taxExempt is true', () => {
    const base = {
      asOfDate: d(2024, 4, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(1),
      subscriptionDate: d(2024, 1, 1),
    };
    const exempt = computeCertificateLotValue({ ...base, taxExempt: true });
    const nonExempt = computeCertificateLotValue({ ...base, taxExempt: false });

    expect(exempt.netInterest).toBeCloseTo(exempt.grossInterest, 10);
    expect(exempt.accruedValue).toBeCloseTo(1007.5, 10);
    expect(nonExempt.netInterest).toBeCloseTo(nonExempt.grossInterest * 0.72, 10);
    expect(nonExempt.accruedValue).toBeCloseTo(1005.4, 10);
    expect(exempt.accruedValue).toBeGreaterThan(nonExempt.accruedValue);
  });

  it('adds the loyalty premium once the lot crosses into a bracketed holding year', () => {
    const result = computeCertificateLotValue({
      asOfDate: d(2025, 4, 1), // 5 full quarters -> the 5th sits in holding year 2
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(5),
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(result.quarters).toHaveLength(5);
    expect(result.quarters[3]?.rateBps).toBe(300); // still holding year 1
    expect(result.quarters[4]?.rateBps).toBe(325); // holding year 2 -> +25bps
  });

  it('moves up to the open-ended bracket in holding year 6', () => {
    const result = computeCertificateLotValue({
      asOfDate: d(2030, 1, 1), // 24 full quarters
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(24),
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(result.quarters).toHaveLength(24);
    expect(result.quarters[19]?.rateBps).toBe(325); // holding year 5 -> yr2-5 bracket
    expect(result.quarters[20]?.rateBps).toBe(350); // holding year 6 -> yr6+ bracket
  });

  it('caps the BASE rate at the series cap and adds the premium on top of the cap, not into it', () => {
    // IGCP's fichas técnicas put the cap/floor on the base-rate FORMULA only ("From application of
    // said formula may not result a base rate exceeding 3.5%, nor below 0%" — Série E; "The base rate
    // may not be higher than 2.50% or lower than 0%" — Série F). The loyalty premium is added AFTER
    // that constraint, so the final total rate routinely exceeds the cap (Série F: 2.50% capped base
    // + 1.75% year-14/15 premium = 4.25% total).
    const highBrackets = [{ premiumBps: 1000, yearFrom: 1, yearTo: null }]; // absurdly high premium: it must survive the clamp intact
    const capped = computeCertificateLotValue({
      asOfDate: d(2024, 4, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: highBrackets,
      principal: 1000,
      rateCapBps: 350,
      rateFloorBps: 0,
      ratePeriods: quarterlyRatePeriods(1, 500), // base 500bps, above the 350bps cap
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    // base 500bps clamped to the 350bps cap, THEN +1000bps premium = 1350bps/yr.
    // 1350bps = 13.5%/yr -> 13.5 / 4 = 3.375%/quarter -> 1000 * 0.03375 = 33.75.
    expect(capped.quarters[0]?.rateBps).toBe(1350);
    expect(capped.quarters[0]?.grossInterest).toBeCloseTo(33.75, 10);
  });

  it('leaves a below-cap base rate alone, and lets a realistic premium carry the total above the cap', () => {
    const underCap = computeCertificateLotValue({
      asOfDate: d(2024, 4, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      rateCapBps: 350,
      rateFloorBps: 0,
      ratePeriods: quarterlyRatePeriods(1, 300), // 300bps base is under the 350bps cap -> untouched
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(underCap.quarters[0]?.rateBps).toBe(300);

    const overCap = computeCertificateLotValue({
      asOfDate: d(2025, 4, 1), // 5 quarters: the 5th sits in holding year 2, where +25bps applies
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      rateCapBps: 350,
      rateFloorBps: 0,
      ratePeriods: quarterlyRatePeriods(5, 400), // 400bps base is over the 350bps cap -> clamped to 350
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(overCap.quarters[3]?.rateBps).toBe(350); // holding year 1: capped base, no premium yet
    expect(overCap.quarters[4]?.rateBps).toBe(375); // holding year 2: capped base 350 + 25bps premium
  });

  it('uses the base rate published for the month each quarter starts in', () => {
    const result = computeCertificateLotValue({
      asOfDate: d(2024, 7, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets, // holding year 1 -> no premium, so rateBps is the base rate
      principal: 1000,
      ratePeriods: [
        { baseRateBps: 300, effectiveMonth: d(2024, 1, 1) },
        { baseRateBps: 400, effectiveMonth: d(2024, 4, 1) },
      ],
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(result.quarters).toHaveLength(2);
    // Q1 starts in January -> 300bps: 1000 * 0.0075 = 7.5, balance 1007.5
    expect(result.quarters[0]?.rateBps).toBe(300);
    expect(result.quarters[0]?.grossInterest).toBeCloseTo(7.5, 10);
    // Q2 starts in April -> 400bps (NOT January's 300, and not an average of the two):
    // 1007.5 * 400 / 10000 / 4 = 1007.5 * 0.01 = 10.075, balance 1017.575
    expect(result.quarters[1]?.rateBps).toBe(400);
    expect(result.quarters[1]?.grossInterest).toBeCloseTo(10.075, 10);
    expect(result.accruedValue).toBeCloseTo(1017.575, 10);
  });

  it('floors the base rate at the series floor when the base rate is negative', () => {
    const result = computeCertificateLotValue({
      asOfDate: d(2024, 4, 1),
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets, // year 1 -> no premium to offset the negative base
      principal: 1000,
      rateCapBps: 350,
      rateFloorBps: 0,
      ratePeriods: [{ baseRateBps: -100, effectiveMonth: d(2024, 1, 1) }],
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(result.quarters[0]?.rateBps).toBe(0);
    expect(result.quarters[0]?.grossInterest).toBe(0);
    expect(result.accruedValue).toBe(1000);
  });

  it('stops accruing at maturity even if asOfDate is later', () => {
    const base = {
      maturityDate: d(2026, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(8),
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    };
    const atMaturity = computeCertificateLotValue({ ...base, asOfDate: d(2026, 1, 1) }); // exactly 2 years
    const pastMaturity = computeCertificateLotValue({ ...base, asOfDate: d(2027, 1, 1) }); // 1 year past maturity

    expect(atMaturity.quarters).toHaveLength(8);
    expect(pastMaturity.accruedValue).toBe(atMaturity.accruedValue);
    expect(pastMaturity.quarters).toHaveLength(atMaturity.quarters.length);
  });

  it('falls back to the most recent known rate when a rate period is missing, and logs a warning', () => {
    const warnSpy = vi.fn<(data: Record<string, unknown>, msg: string) => void>();
    const result = computeCertificateLotValue({
      asOfDate: d(2024, 7, 1),
      logContext: { symbol: 'CA-SERIE-F' },
      logger: { warn: warnSpy },
      maturityDate: d(2034, 1, 1),
      premiumBrackets: standardBrackets,
      principal: 1000,
      ratePeriods: quarterlyRatePeriods(1), // only Q1's month is known; Q2's (April) is missing
      subscriptionDate: d(2024, 1, 1),
      taxExempt: true,
    });
    expect(result.quarters).toHaveLength(2);
    expect(result.quarters[0]?.rateBps).toBe(300);
    expect(result.quarters[1]?.rateBps).toBe(300); // fell back to Q1's rate rather than dropping to 0%
    // Two gaps, two warnings: Q2's April rate (used by the accrual loop) and the currently-accruing
    // quarter's July rate (used by the current-rate display fields). Both are genuinely missing and
    // both are worth surfacing — the second is the *live* rate, so it is if anything the more
    // urgent of the two.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[1]).toMatch(/fallback|missing rate/i);
    // Without the series symbol the alert is unactionable: "some month is missing" across 4 series.
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({ subscriptionDate: d(2024, 1, 1), symbol: 'CA-SERIE-F' });
  });

  it('warns through the app logger when no logger is injected', () => {
    const appLoggerWarn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      computeCertificateLotValue({
        asOfDate: d(2024, 7, 1),
        maturityDate: d(2034, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: quarterlyRatePeriods(1), // Q2's and the current quarter's months are missing
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      });
      expect(appLoggerWarn).toHaveBeenCalledTimes(2);
      expect(appLoggerWarn.mock.calls[0]?.[1]).toMatch(/fallback|missing rate/i);
    } finally {
      appLoggerWarn.mockRestore();
    }
  });

  describe('currentQuarter (the quarter accruing right now, not the last completed one)', () => {
    it('reports the currently-accruing quarter for a lot with ZERO completed quarters', () => {
      // The single most common case: Série F is open for new subscriptions, so a freshly-created
      // lot has no completed quarters at all. Reading "current rate" off the last completed quarter
      // reports 0% for these — the bug this covers.
      const result = computeCertificateLotValue({
        asOfDate: d(2024, 2, 1),
        maturityDate: d(2039, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: quarterlyRatePeriods(1),
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      });

      expect(result.quarters).toHaveLength(0);
      expect(result.currentQuarter).toEqual({
        premiumBps: 0, // holding year 1 earns no loyalty premium under the standard schedule
        quarterEnd: d(2024, 4, 1),
        quarterStart: d(2024, 1, 1),
        rateBps: 300,
        yearsHeld: 1,
      });
    });

    it('advances to the next premium tier on the anniversary rather than a quarter later', () => {
      // Exactly 4 completed quarters = the lot has just entered holding year 2, so the year-2
      // premium is what is accruing now. Deriving years-held from completed quarters alone
      // ((4 - 1) / 4 + 1 = 1) would still report year 1 and a 0bp premium for another quarter.
      const result = computeCertificateLotValue({
        asOfDate: d(2025, 1, 1),
        maturityDate: d(2039, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: quarterlyRatePeriods(5),
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      });

      expect(result.quarters).toHaveLength(4);
      expect(result.quarters.at(-1)!.rateBps).toBe(300); // the 4th quarter was still year 1
      expect(result.currentQuarter).toEqual({
        premiumBps: 25,
        quarterEnd: d(2025, 4, 1),
        quarterStart: d(2025, 1, 1),
        rateBps: 325,
        yearsHeld: 2,
      });
    });

    it('reports no current quarter once the lot has matured', () => {
      const result = computeCertificateLotValue({
        asOfDate: d(2030, 1, 1),
        maturityDate: d(2026, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: quarterlyRatePeriods(1),
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      });

      expect(result.currentQuarter).toBeNull();
    });

    it('reports no current quarter — rather than throwing — when the series has no published rate', () => {
      // A missing rate is fatal *inside* the accrual loop, but the current-quarter fields are a
      // display concern: an unprovisioned series must not stop a lot that has nothing to accrue yet
      // from being valued at its principal.
      const result = computeCertificateLotValue({
        asOfDate: d(2024, 2, 1),
        maturityDate: d(2039, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: [],
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      });

      expect(result.currentQuarter).toBeNull();
      expect(result.accruedValue).toBe(1000);
    });
  });

  it('throws when no rate period exists on or before the first quarter', () => {
    expect(() =>
      computeCertificateLotValue({
        asOfDate: d(2024, 4, 1),
        maturityDate: d(2034, 1, 1),
        premiumBrackets: standardBrackets,
        principal: 1000,
        ratePeriods: [{ baseRateBps: 300, effectiveMonth: d(2024, 4, 1) }], // starts after the lot's first quarter
        subscriptionDate: d(2024, 1, 1),
        taxExempt: true,
      }),
    ).toThrow(/no rate period available/i);
  });
});

/**
 * BLOCKED on IGCP source data. Série C published four cohort variants (2009/2012/2014/2015)
 * whose start dates and premium bps are not enumerated in the design doc, this repo, or Task 1's
 * seed data (see Task 1's "Data note (do not skip)"). `resolvePremiumBrackets` is already covered
 * generically above; what is missing here is a regression test pinning the *real* Série C cohort
 * boundaries so a bad seed row can never silently mis-value a Série C holding. Unskip and fill in
 * once the figures are sourced from IGCP's published fichas técnicas — do NOT invent them.
 */
// eslint-disable-next-line vitest/no-disabled-tests -- deliberate, visible placeholder for blocked source data; `describe.todo` would hide the reason
describe.skip('Série C cohort resolution — BLOCKED on IGCP source data', () => {
  it.todo('resolves each of the four Série C cohorts to its published premium brackets');
});
