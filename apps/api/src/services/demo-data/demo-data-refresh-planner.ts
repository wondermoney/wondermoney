import {
  type DemoBankTransactionFixture,
  demoBankTransactionFixtures,
  type DemoPortfolioTransactionFixture,
  demoPortfolioTransactionFixtures,
} from '@service/demo-data/demo-data-fixtures';

export interface DemoRefreshPlan {
  asOfDate: Date;
  bankTransactions: DemoRefreshPlanBankTransaction[];
  portfolioTransactions: DemoRefreshPlanPortfolioTransaction[];
}

export interface DemoRefreshPlanBankTransaction extends DemoBankTransactionFixture {
  transactionDate: Date;
}

export interface DemoRefreshPlanPortfolioTransaction extends DemoPortfolioTransactionFixture {
  transactionDate: Date;
}

export function buildDemoRefreshPlan({ asOfDate }: { asOfDate: Date }): DemoRefreshPlan {
  const normalizedAsOfDate = startOfUtcDay(asOfDate);

  return {
    asOfDate: normalizedAsOfDate,
    bankTransactions: demoBankTransactionFixtures.map((fixture) => ({
      ...fixture,
      transactionDate: subUtcDays(normalizedAsOfDate, fixture.offsetDays),
    })),
    portfolioTransactions: demoPortfolioTransactionFixtures.map((fixture) => ({
      ...fixture,
      transactionDate: subUtcDays(normalizedAsOfDate, fixture.offsetDays),
    })),
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function subUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
