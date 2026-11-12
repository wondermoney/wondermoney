import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

import { addAccount, addCategory, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Appuser as AppuserEntity } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { AssistantProposal, AssistantProposalKind, AssistantProposalSource, AssistantProposalStatus } from '@entity/AssistantProposal';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditLog } from '@entity/TransactionAuditLog';
import accountRoutes from '@route/account';
import assistantRoutes from '@route/assistant';
import { createApiToken } from '@service/api-token/api-token.service';
import type { ProposalPayload } from '@service/assistant-proposal/assistant-proposal-payload';
import { createProposal } from '@service/assistant-proposal/assistant-proposal.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

const db = useTestDatabase();
useRequestContextEm(db);
const assistant = tenantHttp('/v1/assistant', assistantRoutes);
const account = tenantHttp('/v1/account', accountRoutes);

const DATE = new Date('2026-11-02T12:00:00Z');

/** Draft a proposal the way the propose_* tools do, as `appuser` of `household`. */
async function propose(household: Household, appuser: Appuser, parsed: ProposalPayload, now?: Date) {
  const em = db.em();
  setTenantContext(em, { appuserKey: appuser.appuserKey, tenantKey: household.tenant.tenantKey });
  const result = await createProposal(em, { appuser, tenant: household.tenant }, { source: AssistantProposalSource.ASSISTANT }, parsed, now);
  if (result.status !== 'proposed') throw new Error(`refused: ${result.reason}`);
  return result.proposal;
}

const categorize = (transactionIds: number[], categoryId: number): ProposalPayload => ({ kind: AssistantProposalKind.CATEGORIZE_TRANSACTIONS, payload: { categoryId, transactionIds } });
const review = (transactionIds: number[]): ProposalPayload => ({ kind: AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED, payload: { transactionIds } });
const note = (transactionId: number, text: null | string): ProposalPayload => ({ kind: AssistantProposalKind.UPDATE_TRANSACTION_NOTE, payload: { note: text, transactionId } });

async function auditsOf(transactionKey: number) {
  return db.em().find(TransactionAuditLog, { transactionKey: { transactionKey } }, { filters: false, orderBy: { transactionAuditLogKey: 'asc' } });
}

async function categoryOf(em: EntityManager, transactionKey: number) {
  const link = await em.findOne(AppuserTransactionCategory, { transactionKey: { transactionKey } }, { filters: false });
  return link?.categoryKey.categoryKey ?? null;
}

/** The parts of an audit row a reader compares: everything but its key, its time and its source. */
function comparable(row: TransactionAuditLog) {
  return {
    accountKey: row.accountKey?.accountKey ?? null,
    actorAppuserKey: row.actorAppuserKey?.appuserKey ?? null,
    actorType: row.actorType,
    appuserKey: row.appuserKey.appuserKey,
    changes: row.changes,
    eventType: row.eventType,
  };
}

async function seed() {
  const em = db.em();
  const household = await seedHousehold(em);
  const partner = await addPartner(em, household);
  const groceries = await addCategory(em, household, 'Groceries');
  const dining = await addCategory(em, household, 'Dining');
  const first = await addTransaction(em, household, { amount: -12, category: dining, date: DATE, status: 'BOOKED' });
  const second = await addTransaction(em, household, { amount: -12, category: dining, date: DATE, status: 'BOOKED' });
  return { dining, first, groceries, household, partner, second };
}

describe('applying an assistant proposal', () => {
  it('categorizes exactly as the manual bulk edit does, with the same audit entry', async () => {
    const { dining, first, groceries, household, second } = await seed();

    const manual = await account.as(household.appuser).patch('/v1/account/transaction').send({ categoryId: String(groceries.categoryKey), transactionIds: [first.transactionKey] });
    expect(manual.status).toBe(200);
    const proposal = await propose(household, household.appuser, categorize([second.transactionKey], groceries.categoryKey));

    const applied = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(applied.status).toBe(200);
    expect(applied.body.proposal).toMatchObject({ id: proposal.id, status: 'applied' });
    const em = db.em();
    expect(await categoryOf(em, second.transactionKey)).toBe(groceries.categoryKey);
    const [manualRow, proposalRow] = [await em.findOneOrFail(Transaction, { transactionKey: first.transactionKey }, { filters: false }), await em.findOneOrFail(Transaction, { transactionKey: second.transactionKey }, { filters: false })];
    expect({ categorizationReason: proposalRow.categorizationReason, reviewed: proposalRow.reviewed }).toEqual({ categorizationReason: manualRow.categorizationReason, reviewed: manualRow.reviewed });

    const [manualAudit] = await auditsOf(first.transactionKey);
    const [proposalAudit] = await auditsOf(second.transactionKey);
    if (!manualAudit || !proposalAudit) throw new Error('missing audit row');
    expect(comparable(proposalAudit)).toEqual(comparable(manualAudit));
    expect(proposalAudit.changes).toEqual({ categoryKey: { from: dining.categoryKey, to: groceries.categoryKey }, reviewed: { from: false, to: true } });
    expect(manualAudit.source).toBe('bulk-update');
    expect(proposalAudit.source).toBe('assistant-proposal');
  });

  it('marks reviewed exactly as the manual bulk edit does', async () => {
    const { first, household, second } = await seed();

    await account.as(household.appuser).patch('/v1/account/transaction').send({ reviewed: true, transactionIds: [first.transactionKey] });
    const proposal = await propose(household, household.appuser, review([second.transactionKey]));
    await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`).expect(200);

    const [manualAudit] = await auditsOf(first.transactionKey);
    const [proposalAudit] = await auditsOf(second.transactionKey);
    if (!manualAudit || !proposalAudit) throw new Error('missing audit row');
    expect(comparable(proposalAudit)).toEqual(comparable(manualAudit));
    expect((await db.em().findOneOrFail(Transaction, { transactionKey: second.transactionKey }, { filters: false })).reviewed).toBe(true);
  });

  it('sets a note exactly as the manual single edit does', async () => {
    const { first, household, second } = await seed();

    await account.as(household.appuser).patch(`/v1/account/transaction/${first.transactionKey}`).send({ notes: '  Split with Alex ' }).expect(200);
    const proposal = await propose(household, household.appuser, note(second.transactionKey, '  Split with Alex '));
    await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`).expect(200);

    const em = db.em();
    expect((await em.findOneOrFail(Transaction, { transactionKey: second.transactionKey }, { filters: false })).notes).toBe('Split with Alex');
    const [manualAudit] = await auditsOf(first.transactionKey);
    const [proposalAudit] = await auditsOf(second.transactionKey);
    if (!manualAudit || !proposalAudit) throw new Error('missing audit row');
    expect(comparable(proposalAudit)).toEqual(comparable(manualAudit));
    expect(proposalAudit.changes).toEqual({ notes: { from: null, to: 'Split with Alex' } });
  });

  it('is a no-op the second time', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));

    await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`).expect(200);
    const again = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(again.status).toBe(200);
    expect(again.body.proposal.status).toBe('applied');
    expect(await auditsOf(first.transactionKey)).toHaveLength(1);
  });

  it('is refused to another household, and changes nothing', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    const other = await seedHousehold(db.em());

    const response = await assistant.as(other.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(response.status).toBe(404);
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
    expect((await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: proposal.id }, { filters: false })).status).toBe(AssistantProposalStatus.PENDING);
  });

  it('is refused to the partner: a proposal belongs to the member it was drafted for', async () => {
    const { first, groceries, household, partner } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));

    const response = await assistant.as(partner).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(response.status).toBe(404);
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
  });

  it('fails, changing nothing, when an account went private to the member after the proposal', async () => {
    const { groceries, household, partner } = await seed();
    const em = db.em();
    const partnerAccount = await addAccount(em, household, { name: 'Partner account', owner: partner });
    const row = await addTransaction(em, household, { account: partnerAccount, amount: -9, appuser: partner, date: DATE, status: 'BOOKED' });
    const proposal = await propose(household, household.appuser, categorize([row.transactionKey], groceries.categoryKey));
    await em.nativeUpdate(Account, { accountKey: partnerAccount.accountKey }, { isPrivate: true });

    const response = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('assistant_proposal_failed');
    expect(await categoryOf(db.em(), row.transactionKey)).toBeNull();
    expect(await auditsOf(row.transactionKey)).toHaveLength(0);
    const stored = await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: proposal.id }, { filters: false });
    expect({ failureReason: stored.failureReason, status: stored.status }).toEqual({ failureReason: 'transaction_unavailable', status: AssistantProposalStatus.FAILED });
  });

  it('cannot apply an expired proposal', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey), new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));

    const response = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('assistant_proposal_expired');
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
    expect((await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: proposal.id }, { filters: false })).status).toBe(AssistantProposalStatus.EXPIRED);
  });

  it('cannot be applied with an API token of any scope', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    const { token } = await createApiToken({ appuser: household.appuser, expiresInDays: 30, name: 'Script', scopes: ['read', 'write', 'mcp:read', 'mcp:propose'], tenant: household.tenant }, db.em());

    const applied = await assistant.asToken(token).post(`/v1/assistant/proposals/${proposal.id}/apply`);
    const rejected = await assistant.asToken(token).post(`/v1/assistant/proposals/${proposal.id}/reject`);

    expect(applied.status).toBe(403);
    expect(rejected.status).toBe(403);
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
  });
});

describe('rejecting an assistant proposal', () => {
  it('is idempotent, and a rejected proposal cannot be applied', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));

    const once = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/reject`);
    const twice = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/reject`);
    const apply = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`);

    expect([once.status, twice.status]).toEqual([200, 200]);
    expect(twice.body.proposal).toMatchObject({ decidedAt: once.body.proposal.decidedAt, status: 'rejected' });
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe('assistant_proposal_not_pending');
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
  });

  it('cannot reject an applied proposal', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`).expect(200);

    const response = await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/reject`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('assistant_proposal_not_pending');
  });

  it('is refused to another household', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    const other = await seedHousehold(db.em());

    const response = await assistant.as(other.appuser).post(`/v1/assistant/proposals/${proposal.id}/reject`);

    expect(response.status).toBe(404);
    expect((await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: proposal.id }, { filters: false })).status).toBe(AssistantProposalStatus.PENDING);
  });
});

describe('listing assistant proposals', () => {
  it('lists the member\'s own pending proposals with a live before/after preview', async () => {
    const { dining, first, groceries, household, partner, second } = await seed();
    const mine = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    await propose(household, household.appuser, review([second.transactionKey]), new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await propose(household, partner, review([second.transactionKey]));

    const response = await assistant.as(household.appuser).get('/v1/assistant/proposals?status=pending');

    expect(response.status).toBe(200);
    expect(response.body.proposals).toHaveLength(1);
    expect(response.body.proposals[0]).toMatchObject({
      changes: [{ after: 'Groceries', before: dining.name, field: 'category', transactionId: first.transactionKey }],
      id: mine.id,
      kind: 'categorize_transactions',
      status: 'pending',
    });
  });

  it('refuses every proposal route for a person who hid AI', async () => {
    const { first, groceries, household } = await seed();
    const proposal = await propose(household, household.appuser, categorize([first.transactionKey], groceries.categoryKey));
    await db.em().nativeUpdate(AppuserEntity, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden: true } });

    const responses = [
      await assistant.as(household.appuser).get('/v1/assistant/proposals'),
      await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/apply`),
      await assistant.as(household.appuser).post(`/v1/assistant/proposals/${proposal.id}/reject`),
    ];

    expect(responses.map((response) => [response.status, (response.body as { code?: string }).code])).toEqual([
      [403, 'feature_disabled'],
      [403, 'feature_disabled'],
      [403, 'feature_disabled'],
    ]);
    expect(await auditsOf(first.transactionKey)).toHaveLength(0);
  });
});
