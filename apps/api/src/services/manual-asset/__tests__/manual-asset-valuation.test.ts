import { describe, expect, it } from 'vitest';

import { buildValueSeries, latestValuationOn, valueOn } from '../manual-asset-valuation';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('the value of a manually valued asset on a date', () => {
  const valuations = [
    { date: day('2026-01-10'), key: 1, value: 200_000 },
    { date: day('2026-06-01'), key: 2, value: 230_000 },
  ];

  it('is the latest valuation on or before the date', () => {
    expect(valueOn({ valuations }, day('2026-01-10'))).toBe(200_000);
    expect(valueOn({ valuations }, day('2026-03-15'))).toBe(200_000);
    expect(valueOn({ valuations }, day('2026-05-31'))).toBe(200_000);
    expect(valueOn({ valuations }, day('2026-06-01'))).toBe(230_000);
    expect(valueOn({ valuations }, day('2026-12-31'))).toBe(230_000);
  });

  it('counts a valuation for the whole of its day, whatever the time asked for', () => {
    expect(valueOn({ valuations }, new Date('2026-06-01T23:59:59.999Z'))).toBe(230_000);
    expect(valueOn({ valuations }, new Date('2026-05-31T23:59:59.999Z'))).toBe(200_000);
  });

  it('has no value before the first valuation', () => {
    expect(valueOn({ valuations }, day('2026-01-09'))).toBeNull();
    expect(valueOn({ valuations: [] }, day('2026-01-09'))).toBeNull();
  });

  it('does not depend on the order the valuations arrive in', () => {
    expect(valueOn({ valuations: [...valuations].reverse() }, day('2026-03-15'))).toBe(200_000);
  });

  it('takes the newest record when two valuations share a day', () => {
    const sameDay = [{ date: day('2026-01-10'), key: 4, value: 150 }, { date: day('2026-01-10'), key: 9, value: 175 }];
    expect(valueOn({ valuations: sameDay }, day('2026-02-01'))).toBe(175);
    expect(latestValuationOn(sameDay, day('2026-02-01'))?.key).toBe(9);
  });

  it('stops counting from the day the asset was archived', () => {
    const archivedAt = new Date('2026-07-15T14:30:00.000Z');
    expect(valueOn({ archivedAt, valuations }, day('2026-07-14'))).toBe(230_000);
    expect(valueOn({ archivedAt, valuations }, day('2026-07-15'))).toBeNull();
    expect(valueOn({ archivedAt, valuations }, day('2026-09-01'))).toBeNull();
  });

  describe('with a growth rule', () => {
    const base = [{ date: day('2025-01-01'), key: 1, value: 100_000 }];

    it('compounds yearly from the last valuation: 100 000 at 5% is 105 000 a year later', () => {
      expect(valueOn({ growthRule: { annualRatePercent: 5 }, valuations: base }, day('2026-01-01'))).toBe(105_000);
    });

    it('compounds over two years: 100 000 at 5% is 110 250 after 730 days', () => {
      expect(valueOn({ growthRule: { annualRatePercent: 5 }, valuations: base }, day('2027-01-01'))).toBe(110_250);
    });

    it('compounds a part of a year by days over 365: 100 000 at 10% after 73 days is 101 924.4876', () => {
      // 1.1 ^ (73 / 365) = 1.1 ^ 0.2 = 1.019244876...
      expect(valueOn({ growthRule: { annualRatePercent: 10 }, valuations: base }, day('2025-03-15'))).toBe(101_924.4876);
    });

    it('depreciates with a negative rate: a 20 000 car at -15% is 17 000 a year later', () => {
      expect(valueOn({ growthRule: { annualRatePercent: -15 }, valuations: [{ date: day('2025-01-01'), key: 1, value: 20_000 }] }, day('2026-01-01'))).toBe(17_000);
    });

    it('is the valuation itself on the day it was recorded', () => {
      expect(valueOn({ growthRule: { annualRatePercent: 5 }, valuations: base }, day('2025-01-01'))).toBe(100_000);
    });

    it('starts again from a newer valuation instead of compounding the older one', () => {
      const two = [...base, { date: day('2026-01-01'), key: 2, value: 120_000 }];
      expect(valueOn({ growthRule: { annualRatePercent: 5 }, valuations: two }, day('2026-01-01'))).toBe(120_000);
      expect(valueOn({ growthRule: { annualRatePercent: 5 }, valuations: two }, day('2027-01-01'))).toBe(126_000);
    });

    it('stays flat until the rule\'s start date, then compounds from that date', () => {
      const growthRule = { annualRatePercent: 5, startDate: day('2025-07-01') };
      expect(valueOn({ growthRule, valuations: base }, day('2025-06-30'))).toBe(100_000);
      expect(valueOn({ growthRule, valuations: base }, day('2025-07-01'))).toBe(100_000);
      expect(valueOn({ growthRule, valuations: base }, day('2026-07-01'))).toBe(105_000);
    });

    it('compounds from the valuation when the rule started before it', () => {
      const growthRule = { annualRatePercent: 5, startDate: day('2020-01-01') };
      expect(valueOn({ growthRule, valuations: base }, day('2026-01-01'))).toBe(105_000);
    });
  });
});

describe('the value series of an asset', () => {
  it('has one stepped point per valuation and one for today', () => {
    const series = buildValueSeries({ valuations: [{ date: day('2026-01-10'), key: 1, value: 200_000 }, { date: day('2026-06-01'), key: 2, value: 230_000 }] }, day('2026-08-20'));

    expect(series).toEqual([
      { date: '2026-01-10', value: 200_000 },
      { date: '2026-06-01', value: 230_000 },
      { date: '2026-08-20', value: 230_000 },
    ]);
  });

  it('adds month ends between points when a growth rule moves the value', () => {
    const series = buildValueSeries({ growthRule: { annualRatePercent: 5 }, valuations: [{ date: day('2026-01-10'), key: 1, value: 100_000 }] }, day('2026-03-15'));

    expect(series.map((point) => point.date)).toEqual(['2026-01-10', '2026-01-31', '2026-02-28', '2026-03-15']);
    expect(series[0]?.value).toBe(100_000);
    expect(series.at(-1)?.value).toBeGreaterThan(series[1]?.value ?? Infinity);
  });

  it('ends on the day before an archived asset stopped counting', () => {
    const series = buildValueSeries({ archivedAt: new Date('2026-03-10T10:00:00Z'), valuations: [{ date: day('2026-01-10'), key: 1, value: 500 }] }, day('2026-08-20'));

    expect(series).toEqual([{ date: '2026-01-10', value: 500 }, { date: '2026-03-09', value: 500 }]);
  });

  it('is empty for an asset with no valuation yet', () => {
    expect(buildValueSeries({ valuations: [] }, day('2026-08-20'))).toEqual([]);
  });

  it('leaves out valuations dated after today', () => {
    const series = buildValueSeries({ valuations: [{ date: day('2026-01-10'), key: 1, value: 500 }, { date: day('2027-01-01'), key: 2, value: 900 }] }, day('2026-08-20'));

    expect(series).toEqual([{ date: '2026-01-10', value: 500 }, { date: '2026-08-20', value: 500 }]);
  });
});
