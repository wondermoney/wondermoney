import { describe, expect, it } from 'vitest';

import { demoBankTransactionFixtures, demoPortfolioTransactionFixtures } from '@service/demo-data/demo-data-fixtures';
import { buildDemoRefreshPlan } from '@service/demo-data/demo-data-refresh-planner';

describe('demo data refresh planner', () => {
  it('returns deterministic plans for the same as-of date', () => {
    const asOfDate = new Date('2026-06-05T15:30:00.000Z');

    const firstPlan = buildDemoRefreshPlan({ asOfDate });
    const secondPlan = buildDemoRefreshPlan({ asOfDate: new Date('2026-06-05T00:00:00.000Z') });

    expect(firstPlan).toEqual(secondPlan);
    expect(firstPlan.asOfDate.toISOString()).toBe('2026-06-05T00:00:00.000Z');
  });

  it('derives transaction dates from fixture offsets', () => {
    const asOfDate = new Date('2026-06-05T15:30:00.000Z');
    const plan = buildDemoRefreshPlan({ asOfDate });

    const bankFixture = demoBankTransactionFixtures.find((row) => row.offsetDays === 30);
    const portfolioFixture = demoPortfolioTransactionFixtures.find((row) => row.offsetDays === 24);

    expect(bankFixture).toBeDefined();
    expect(portfolioFixture).toBeDefined();

    if (!bankFixture || !portfolioFixture) {
      throw new Error('Expected known demo fixtures to exist');
    }

    expect(plan.bankTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalTransactionId: bankFixture.externalTransactionId,
          transactionDate: new Date('2026-05-06T00:00:00.000Z'),
        }),
      ]),
    );

    expect(plan.portfolioTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalTransactionId: portfolioFixture.externalTransactionId,
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
        }),
      ]),
    );
  });

  it('does not mutate source fixtures', () => {
    const bankFixtureSnapshot = structuredClone(demoBankTransactionFixtures);
    const portfolioFixtureSnapshot = structuredClone(demoPortfolioTransactionFixtures);

    buildDemoRefreshPlan({ asOfDate: new Date('2026-06-05T15:30:00.000Z') });

    expect(demoBankTransactionFixtures).toEqual(bankFixtureSnapshot);
    expect(demoPortfolioTransactionFixtures).toEqual(portfolioFixtureSnapshot);
    expect(demoBankTransactionFixtures[0]).not.toHaveProperty('transactionDate');
    expect(demoPortfolioTransactionFixtures[0]).not.toHaveProperty('transactionDate');
  });
});
