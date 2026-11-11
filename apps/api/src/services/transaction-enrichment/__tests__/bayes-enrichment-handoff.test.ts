import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { addMerchant, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Category } from '@entity/Category';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionEnrichment } from '@entity/TransactionEnrichment';
import type { TransactionMerchant } from '@entity/TransactionMerchant';
import { applyBayesCategorization, prepareBayesCategorization } from '@service/transaction/bayes-categorization.service';

import { enqueueTransactionEnrichmentForTenant } from '../transaction-enrichment-enqueue.service';

const db = useTestDatabase();

const config = {
  dailyTenantBudget: 50,
  enabled: true,
  expirationSeconds: 300,
  mode: 'write' as const,
  modelVersion: 'DeepSeek-V4-Flash',
  promptVersion: 'transaction-enrichment-v1',
  retentionSeconds: 1_209_600,
  retryDelaySeconds: 60,
  retryLimit: 3,
  writeConfidenceThreshold: 0.7,
};

async function addOwnCategory(em: EntityManager, household: Household, name: string): Promise<Category> {
  const category = em.create(Category, { appuserKey: household.appuser, bgColor: '#000', isSystemCategory: false, name, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
  await em.flush();
  return category;
}

async function seedHistory(em: EntityManager, household: Household, category: Category, merchant: TransactionMerchant, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await addTransaction(em, household, {
      account: household.account,
      amount: -(5 + index),
      category,
      date: new Date(Date.UTC(2026, 0, 1 + index)),
      merchant,
      status: 'BOOKED',
    });
  }
}

/*
 * A row the local Bayes pass labels is already categorized: it must never be sent to a model. A row
 * the pass abstains on still is, so the AI path keeps its reach.
 */
describe('bayes categorization and the AI enrichment handoff', () => {
  it('enqueues only the rows the local pass left unassigned', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addOwnCategory(em, household, 'Groceries');
    const fuel = await addOwnCategory(em, household, 'Fuel');
    const continente = await addMerchant(em, household, 'Continente');
    const galp = await addMerchant(em, household, 'Galp');
    await seedHistory(em, household, groceries, continente, 12);
    await seedHistory(em, household, fuel, galp, 12);

    const known = await addTransaction(em, household, { amount: -22, date: new Date('2026-06-01T00:00:00Z'), merchant: continente, status: 'BOOKED' });
    const obscureMerchant = await addMerchant(em, household, 'Obscure Vendor');
    const obscure = await addTransaction(em, household, { amount: -33, date: new Date('2026-06-01T00:00:00Z'), merchant: obscureMerchant, status: 'BOOKED' });
    await em.nativeUpdate(
      Transaction,
      { transactionKey: { $in: [known.transactionKey, obscure.transactionKey] } },
      { categorizationConfidence: CategorizationConfidence.NONE },
    );

    const work = db.em();
    const rows = await work.find(Transaction, { transactionKey: { $in: [known.transactionKey, obscure.transactionKey] } });
    const batch = await prepareBayesCategorization(work, { tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
    expect(await applyBayesCategorization(work, batch, rows)).toBe(1);

    const labeled = await db.em().findOneOrFail(Transaction, { transactionKey: known.transactionKey });
    expect(labeled.categorizationReason).toBe('bayes_suggested');
    expect(labeled.categorizationConfidence).toBe(CategorizationConfidence.MEDIUM);

    const enqueue = { send: vi.fn().mockResolvedValue('job-id'), sendAfter: vi.fn() };
    await enqueueTransactionEnrichmentForTenant(household.tenant.tenantKey, 'account-initial-sync', { config, em: db.em(), enqueue });

    const enriched = await db.em().find(TransactionEnrichment, {});
    expect(enriched.map((row) => row.transactionKey.transactionKey)).toEqual([obscure.transactionKey]);
    expect(enqueue.send).toHaveBeenCalledTimes(1);
  });
});
