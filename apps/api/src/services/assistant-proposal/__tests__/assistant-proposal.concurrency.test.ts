import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { AssistantProposal, AssistantProposalKind, AssistantProposalSource, AssistantProposalStatus } from '@entity/AssistantProposal';
import { TransactionAuditLog } from '@entity/TransactionAuditLog';
import { applyProposal, createProposal } from '@service/assistant-proposal/assistant-proposal.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

/*
 * Two taps on Apply (two tabs, a double click) arrive as two requests at once. The proposal row is
 * locked for the whole apply, so the change happens once and the second request sees `applied`.
 * Two sessions contending need a real server; PGlite is a single backend (see `pg-test-db.ts`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('applying one proposal from two requests at once', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  it('makes the change once', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries');
    const transaction = await addTransaction(em, household, { amount: -12, date: new Date('2026-11-02T12:00:00Z'), status: 'BOOKED' });
    const viewer = { appuser: household.appuser, tenant: household.tenant };
    const requestEm = () => {
      const fork = db.em();
      setTenantContext(fork, { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });
      return fork;
    };
    const created = await createProposal(requestEm(), viewer, { source: AssistantProposalSource.ASSISTANT }, {
      kind: AssistantProposalKind.CATEGORIZE_TRANSACTIONS,
      payload: { categoryId: groceries.categoryKey, transactionIds: [transaction.transactionKey] },
    });
    if (created.status !== 'proposed') throw new Error('refused');

    const results = await Promise.all(Array.from({ length: 3 }, () => applyProposal(requestEm(), viewer, created.proposal.id)));

    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    const check = db.em();
    await expect(check.count(TransactionAuditLog, { transactionKey: { transactionKey: transaction.transactionKey } }, { filters: false })).resolves.toBe(1);
    await expect(check.findOneOrFail(AssistantProposal, { assistantProposalKey: created.proposal.id }, { filters: false })).resolves.toMatchObject({ status: AssistantProposalStatus.APPLIED });
  });
});
