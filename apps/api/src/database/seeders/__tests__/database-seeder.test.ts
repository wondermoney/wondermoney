import { describe, expect, it, vi } from 'vitest';

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';

import { DatabaseSeeder } from '../DatabaseSeeder';
import { demoPersona } from '../demo/demo-fixtures';
import { ReferenceDataSeeder } from '../ReferenceDataSeeder';

// The seeded users' better-auth credentials live outside the schema under test.
vi.mock('../../utils/better-auth-user', () => ({
  createUser: ({ email }: { email: string }) => Promise.resolve({ id: `auth-${email}` }),
}));
// The full exchange-rate history and 45k-symbol catalog take minutes to insert and nothing in the
// demo data set reads them: keep only the stocks the demo portfolios hold.
vi.mock('../exchange_rate_eur_ecb_20200101_20221215.json', () => ({ default: [] }));
vi.mock('../stock_list_clean.json', async (importOriginal) => {
  const { default: stocks } = await importOriginal<{ default: { symbol: string }[] }>();
  const { demoPortfolioHoldings } = await import('../demo/demo-portfolio');
  const held = new Set<string>(demoPortfolioHoldings.map((holding) => holding.symbol));
  return { default: stocks.filter((stock) => held.has(stock.symbol)) };
});

async function seededDemoData(db: ReturnType<typeof useTestDatabase>) {
  const em = db.em();
  const demoUser = await em.findOneOrFail(Appuser, { emailAddress: demoPersona.email });
  return {
    currencies: await em.count(Currency, {}),
    demoAccounts: await em.find(Account, { accountOwnerAppuserKey: demoUser }, { populate: ['currencyKey'] }),
    demoCategories: await em.count(Category, { appuserKey: demoUser }),
    eurCurrencies: await em.count(Currency, { code: 'EUR' }),
    transactionCategories: await em.count(AppuserTransactionCategory, {}),
  };
}

/*
 * `pnpm migrate:dev` loads the reference data into an empty database, and `pnpm seed:dev` then
 * adds the development data set on top of it. Both orders a developer can reach must work.
 */
describe('seeding the development data set', () => {
  const db = useTestDatabase();

  it('builds on reference data that is already in the database, without inserting it again', async () => {
    await new ReferenceDataSeeder().run(db.em());
    const currenciesBefore = await db.em().count(Currency, {});

    await new DatabaseSeeder().run(db.em());

    const seeded = await seededDemoData(db);
    expect(seeded.currencies).toBe(currenciesBefore);
    expect(seeded.eurCurrencies).toBe(1);
    expect(seeded.demoAccounts.map((account) => account.currencyKey?.code).sort()).toEqual(['EUR', 'EUR', 'USD']);
    expect(seeded.demoCategories).toBeGreaterThan(0);
    expect(seeded.transactionCategories).toBeGreaterThan(0);
  }, 60_000);

  it('seeds the reference data too when the database has none', async () => {
    await new DatabaseSeeder().run(db.em());

    const seeded = await seededDemoData(db);
    expect(seeded.eurCurrencies).toBe(1);
    expect(seeded.demoAccounts).toHaveLength(3);
    expect(seeded.demoCategories).toBeGreaterThan(0);
    expect(seeded.transactionCategories).toBeGreaterThan(0);
  }, 60_000);

  // The web app shows these as "Balances updated ..."; a date in the future read as "in 20 years".
  it('dates the demo accounts\' last sync in the recent past', async () => {
    const before = Date.now();
    await new DatabaseSeeder().run(db.em());

    const { demoAccounts } = await seededDemoData(db);
    expect(demoAccounts).not.toHaveLength(0);
    for (const account of demoAccounts) {
      for (const syncedAt of [account.refreshedAt, account.transactionsRefreshedAt]) {
        expect(syncedAt?.getTime()).toBeLessThanOrEqual(before);
        expect(syncedAt?.getTime()).toBeGreaterThan(before - 24 * 60 * 60 * 1000);
      }
    }
  }, 60_000);
});
