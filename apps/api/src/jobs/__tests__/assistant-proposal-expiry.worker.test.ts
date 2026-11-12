import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { handleAssistantProposalExpiryJob } from '@app/jobs/assistant-proposal-expiry.worker';
import { AssistantProposal, AssistantProposalKind, AssistantProposalSource, AssistantProposalStatus } from '@entity/AssistantProposal';
import { createProposal, rejectProposal } from '@service/assistant-proposal/assistant-proposal.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();
const DAY = 24 * 60 * 60 * 1000;
const job = { data: {}, id: 'job-1' } as unknown as Job<Record<string, never>>;

describe('the assistant proposal expiry job', () => {
  it('expires pending proposals older than seven days, in every household, and nothing else', async () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const draft = async (createdAt: Date) => {
      const em = db.em();
      const household = await seedHousehold(em);
      const transaction = await addTransaction(em, household, { amount: -5, date: new Date('2026-11-01T12:00:00Z'), status: 'BOOKED' });
      setTenantContext(em, { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });
      const result = await createProposal(em, { appuser: household.appuser, tenant: household.tenant }, { source: AssistantProposalSource.MCP }, {
        kind: AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED,
        payload: { transactionIds: [transaction.transactionKey] },
      }, createdAt);
      if (result.status !== 'proposed') throw new Error('refused');
      return { em, household, id: result.proposal.id };
    };
    const lapsed = await draft(new Date(now.getTime() - 8 * DAY));
    const fresh = await draft(new Date(now.getTime() - 6 * DAY));
    const dismissed = await draft(new Date(now.getTime() - 9 * DAY));
    await rejectProposal(dismissed.em, { appuser: dismissed.household.appuser, tenant: dismissed.household.tenant }, dismissed.id, new Date(now.getTime() - 8.5 * DAY));

    const result = await handleAssistantProposalExpiryJob(job, { em: db.em(), logger: { info: vi.fn() }, now: () => now });

    expect(result).toEqual({ expired: 1 });
    const status = async (id: number) => (await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: id }, { filters: false })).status;
    expect(await status(lapsed.id)).toBe(AssistantProposalStatus.EXPIRED);
    expect(await status(fresh.id)).toBe(AssistantProposalStatus.PENDING);
    expect(await status(dismissed.id)).toBe(AssistantProposalStatus.REJECTED);
    expect(await handleAssistantProposalExpiryJob(job, { em: db.em(), logger: { info: vi.fn() }, now: () => now })).toEqual({ expired: 0 });
  });
});
