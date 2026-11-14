import { describe, expect, it, vi } from 'vitest';

import { addAccount, addMerchant, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionEnrichment } from '@entity/TransactionEnrichment';

import { enqueueTransactionEnrichmentForTenant } from '../transaction-enrichment-enqueue.service';

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

/*
 * Enrichment sends transaction text to a model. A person who hid AI must have nothing sent, even
 * when the household partner still uses it: the skip is per account owner, not per household.
 */
describe('transaction enrichment and a person who hid AI', () => {
  const db = useTestDatabase();

  async function seedTwoOwners() {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const merchant = await addMerchant(em, household, 'Cafe Central');
    const hiddenOwnerAccount = await addAccount(em, household, { name: 'Hidden owner', owner: household.appuser });
    const partnerAccount = await addAccount(em, household, { name: 'Partner', owner: partner });
    const hiddenOwnerTransaction = await addTransaction(em, household, { account: hiddenOwnerAccount, amount: -5, date: new Date('2026-07-10T12:00:00Z'), merchant, status: 'BOOKED' });
    const partnerTransaction = await addTransaction(em, household, { account: partnerAccount, amount: -6, appuser: partner, date: new Date('2026-07-10T12:00:00Z'), merchant, status: 'BOOKED' });
    await em.nativeUpdate(Transaction, { transactionKey: { $in: [hiddenOwnerTransaction.transactionKey, partnerTransaction.transactionKey] } }, { categorizationConfidence: CategorizationConfidence.NONE });
    return { em, hiddenOwnerTransaction, household, partnerTransaction };
  }

  it('skips the hidden owner’s accounts and still enriches the partner’s', async () => {
    const { em, hiddenOwnerTransaction, household, partnerTransaction } = await seedTwoOwners();
    await em.nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden: true } });
    const enqueue = { send: vi.fn().mockResolvedValue('job-id'), sendAfter: vi.fn() };

    await enqueueTransactionEnrichmentForTenant(household.tenant.tenantKey, 'account-initial-sync', { config, em, enqueue });

    const rows = await em.find(TransactionEnrichment, {});
    expect(rows.map((row) => row.transactionKey.transactionKey)).toEqual([partnerTransaction.transactionKey]);
    expect(rows.map((row) => row.transactionKey.transactionKey)).not.toContain(hiddenOwnerTransaction.transactionKey);
    expect(enqueue.send).toHaveBeenCalledTimes(1);
  });

  it('enriches both owners when neither hid AI', async () => {
    const { em, household } = await seedTwoOwners();
    const enqueue = { send: vi.fn().mockResolvedValue('job-id'), sendAfter: vi.fn() };

    await enqueueTransactionEnrichmentForTenant(household.tenant.tenantKey, 'account-initial-sync', { config, em, enqueue });

    expect(await em.count(TransactionEnrichment, {})).toBe(2);
    expect(enqueue.send).toHaveBeenCalledTimes(2);
  });
});
