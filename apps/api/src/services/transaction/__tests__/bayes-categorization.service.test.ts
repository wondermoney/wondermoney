import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import type { TransactionMerchant } from '@entity/TransactionMerchant';

import { applyBayesCategorization, loadBayesTrainingSamples, prepareBayesCategorization } from '../bayes-categorization.service';

const db = useTestDatabase();

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A category the viewer owns, so the assignment resolver accepts it (system ones work too). */
async function addOwnCategory(em: EntityManager, household: Household, name: string): Promise<Category> {
  const category = em.create(Category, { appuserKey: household.appuser, bgColor: '#000', isSystemCategory: false, name, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
  await em.flush();
  return category;
}

async function seedHistory(em: EntityManager, household: Household, category: Category, merchant: TransactionMerchant, count: number, appuser = household.appuser): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await addTransaction(em, household, {
      account: household.account,
      amount: -(5 + index),
      appuser,
      category,
      date: new Date(Date.UTC(2026, 0, 1 + index)),
      merchant,
      status: 'BOOKED',
    });
  }
}

async function seedTwoCategories(em: EntityManager, household: Household) {
  const groceries = await addOwnCategory(em, household, 'Groceries');
  const fuel = await addOwnCategory(em, household, 'Fuel');
  const continente = await addMerchant(em, household, 'Continente');
  const galp = await addMerchant(em, household, 'Galp');
  await seedHistory(em, household, groceries, continente, 12);
  await seedHistory(em, household, fuel, galp, 12);
  return { continente, fuel, galp, groceries };
}

describe('bayes categorization service', () => {
  it('assigns a confident match with bayes_suggested and medium confidence', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { continente, groceries } = await seedTwoCategories(em, household);
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(batch?.model).not.toBeNull();
    expect(await applyBayesCategorization(em, batch, [target])).toBe(1);

    const saved = await db.em().findOneOrFail(Transaction, { transactionKey: target.transactionKey });
    expect(saved.categorizationReason).toBe('bayes_suggested');
    expect(saved.categorizationConfidence).toBe(CategorizationConfidence.MEDIUM);
    expect(saved.reviewed).toBe(false);

    const assignment = await db.em().findOneOrFail(AppuserTransactionCategory, { appuserKey: household.appuser, transactionKey: target });
    expect(assignment.categoryKey.categoryKey).toBe(groceries.categoryKey);
    expect(assignment.source).toBe(Source.DETERMINISTIC);
  });

  it('abstains below the labelled-row floor', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addOwnCategory(em, household, 'Groceries');
    const fuel = await addOwnCategory(em, household, 'Fuel');
    const continente = await addMerchant(em, household, 'Continente');
    const galp = await addMerchant(em, household, 'Galp');
    await seedHistory(em, household, groceries, continente, 9);
    await seedHistory(em, household, fuel, galp, 9);
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(batch?.model).toBeNull();
    expect(await applyBayesCategorization(em, batch, [target])).toBe(0);
    expect(await db.em().count(AppuserTransactionCategory, { transactionKey: target })).toBe(0);
  });

  it('does nothing when the switch is off', async () => {
    vi.stubEnv('TRANSACTION_BAYES_CATEGORIZATION_ENABLED', 'false');
    const em = db.em();
    const household = await seedHousehold(em);
    const { continente } = await seedTwoCategories(em, household);
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(batch).toBeNull();
    expect(await applyBayesCategorization(em, batch, [target])).toBe(0);
    expect(await db.em().count(AppuserTransactionCategory, { transactionKey: target })).toBe(0);
  });

  it('never assigns a withdrawal or transfer description', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { galp } = await seedTwoCategories(em, household);
    const target = await addTransaction(em, household, { amount: -40, date: new Date('2026-06-01T00:00:00Z'), merchant: galp, status: 'BOOKED' });
    target.description = 'LEV ATM 3170 BPI Braga';
    await em.flush();

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(await applyBayesCategorization(em, batch, [target])).toBe(0);
  });

  it('leaves an already categorized row alone', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { continente, groceries } = await seedTwoCategories(em, household);
    const target = await addTransaction(em, household, { amount: -22, category: groceries, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(await applyBayesCategorization(em, batch, [target])).toBe(0);
    expect(await db.em().count(AppuserTransactionCategory, { transactionKey: target })).toBe(1);
  });

  it('does not train on a co-member’s private account', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const groceries = await addOwnCategory(em, household, 'Groceries');
    const fuel = await addOwnCategory(em, household, 'Fuel');
    const restaurants = await addOwnCategory(em, household, 'Restaurants');
    const continente = await addMerchant(em, household, 'Continente');
    const galp = await addMerchant(em, household, 'Galp');
    const cafe = await addMerchant(em, household, 'Cafe Central');
    // The viewer has one category only; the others exist solely on the partner's private account.
    await seedHistory(em, household, groceries, continente, 24);
    const privateAccount = await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
    for (const [category, merchant] of [[fuel, galp], [restaurants, cafe]] as const) {
      for (let index = 0; index < 12; index += 1) {
        await addTransaction(em, household, {
          account: privateAccount,
          amount: -(5 + index),
          appuser: partner,
          category,
          date: new Date(Date.UTC(2026, 0, 1 + index)),
          merchant,
          status: 'BOOKED',
        });
      }
    }
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: galp, status: 'BOOKED' });

    const viewerBatch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(viewerBatch?.model).toBeNull();
    expect(await applyBayesCategorization(em, viewerBatch, [target])).toBe(0);

    // The partner's own model does see their private rows.
    const partnerBatch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: partner.appuserKey });
    expect(partnerBatch?.model).not.toBeNull();
  });

  it('does not train on another household', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const neighbour = await seedHousehold(em);
    const groceries = await addOwnCategory(em, household, 'Groceries');
    const fuel = await addOwnCategory(em, neighbour, 'Fuel');
    const continente = await addMerchant(em, household, 'Continente');
    const galp = await addMerchant(em, neighbour, 'Galp');
    await seedHistory(em, household, groceries, continente, 24);
    await seedHistory(em, neighbour, fuel, galp, 24);
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: galp, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(batch?.model).toBeNull();
    expect(await applyBayesCategorization(em, batch, [target])).toBe(0);
  });

  it('works with no AI provider configured', async () => {
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('AI_BASE_URL', '');
    vi.stubEnv('AZURE_OPENAI_API_KEY', '');
    vi.stubEnv('AZURE_AI_FOUNDRY_API_KEY', '');
    const em = db.em();
    const household = await seedHousehold(em);
    const { continente } = await seedTwoCategories(em, household);
    const target = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });

    const batch = await prepareBayesCategorization(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(await applyBayesCategorization(em, batch, [target])).toBe(1);
  });
});

describe('bayes training loader', () => {
  it('only counts the viewer’s own confirmed categories', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const groceries = await addOwnCategory(em, household, 'Groceries');
    const fuel = await addOwnCategory(em, household, 'Fuel');
    const continente = await addMerchant(em, household, 'Continente');
    const galp = await addMerchant(em, household, 'Galp');
    await seedHistory(em, household, groceries, continente, 12);
    // The partner's rows sit on the shared account but were categorized by the partner.
    await seedHistory(em, household, fuel, galp, 12, partner);

    const samples = await loadBayesTrainingSamples(em, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(samples).toHaveLength(12);
    expect(new Set(samples.map((sample) => sample.categoryKey))).toEqual(new Set([groceries.categoryKey]));
  });
});
