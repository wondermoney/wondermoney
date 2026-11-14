import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addCategory, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { AssistantProposal, AssistantProposalSource, AssistantProposalStatus } from '@entity/AssistantProposal';
import { AI_PROPOSAL_TOOL_DEFINITIONS } from '@service/ai-tools/ai-proposal-tools.service';
import { type AiToolContext, type AiToolName, executeAiTool } from '@service/ai-tools/ai-tool-types';
import type { CreateProposalResult } from '@service/assistant-proposal/assistant-proposal.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();

/** Tables a proposal tool may write: its own row, and nothing a person's finances live in. */
const PROPOSAL_TABLES = new Set(['assistant_proposal', 'mikro_orm_migrations']);

/**
 * Every row of every other table, as JSON, so a write anywhere outside `assistant_proposal`
 * (a transaction, a category link, an audit row, a merchant vote) shows up as a difference.
 */
async function runTool(name: AiToolName, input: unknown, context: AiToolContext) {
  const definition = AI_PROPOSAL_TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`No tool ${name}`);
  const result = await executeAiTool<CreateProposalResult>(definition, input, context);
  return result.data;
}

async function snapshotDomainTables(): Promise<Record<string, unknown>> {
  const connection = db.em().getConnection();
  const tables = (await connection.execute<{ table_name: string }[]>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )).map((row) => row.table_name).filter((name) => !PROPOSAL_TABLES.has(name));
  const snapshot: Record<string, unknown> = {};
  for (const table of tables) {
    const [row] = await connection.execute<{ rows: unknown }[]>(`select coalesce(json_agg(t order by t::text), '[]'::json) as rows from "${table}" t`);
    snapshot[table] = row?.rows;
  }
  return snapshot;
}

describe('propose_* tools', () => {
  beforeEach(() => {
    DI.em = db.em();
  });

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const other = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries');
    const otherCategory = await addCategory(em, other, 'Other household category');
    const partnerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
    const date = new Date('2026-11-02T12:00:00Z');
    const mine = await addTransaction(em, household, { amount: -12, date, status: 'BOOKED' });
    const mineToo = await addTransaction(em, household, { amount: -30, date, status: 'BOOKED' });
    const partnerPrivateRow = await addTransaction(em, household, { account: partnerPrivate, amount: -50, appuser: partner, date, status: 'BOOKED' });
    const otherRow = await addTransaction(em, other, { amount: -40, date, status: 'BOOKED' });
    return { groceries, household, mine, mineToo, other, otherCategory, otherRow, partnerPrivateRow };
  }

  const contextFor = (household: { appuser: { appuserKey: number }; tenant: { tenantKey: number } }, origin?: AiToolContext['origin']): AiToolContext => ({
    appuserKey: household.appuser.appuserKey,
    currency: 'EUR',
    origin,
    tenantKey: household.tenant.tenantKey,
  });

  it('never changes a domain table: only the proposal row is written', async () => {
    const { groceries, household, mine, mineToo } = await seed();
    const before = await snapshotDomainTables();

    const results = [
      await runTool('propose_categorize_transactions', { categoryId: groceries.categoryKey, transactionIds: [mine.transactionKey, mineToo.transactionKey] }, contextFor(household)),
      await runTool('propose_mark_transactions_reviewed', { transactionIds: [mine.transactionKey] }, contextFor(household)),
      await runTool('propose_update_transaction_note', { note: 'Split with Alex', transactionId: mine.transactionKey }, contextFor(household)),
    ];

    expect(results.map((result) => result.status)).toEqual(['proposed', 'proposed', 'proposed']);
    expect(await snapshotDomainTables()).toEqual(before);
    expect(await db.em().count(AssistantProposal, {}, { filters: false })).toBe(3);
  });

  it('returns the proposal id, a summary and a before/after preview', async () => {
    const { groceries, household, mine } = await seed();

    const result = await runTool('propose_categorize_transactions', { categoryId: groceries.categoryKey, transactionIds: [mine.transactionKey, mine.transactionKey] }, contextFor(household));

    if (result.status !== 'proposed') throw new Error(`refused: ${result.reason}`);
    expect(result.proposal).toMatchObject({
      changes: [{ after: 'Groceries', before: null, field: 'category', transactionId: mine.transactionKey }],
      id: expect.any(Number),
      kind: 'categorize_transactions',
      source: 'assistant',
      status: 'pending',
      summary: expect.stringContaining('Groceries'),
      unavailableCount: 0,
    });
  });

  it('records an MCP client and its token as the source', async () => {
    const { household, mine } = await seed();

    const result = await runTool('propose_mark_transactions_reviewed', { transactionIds: [mine.transactionKey] }, contextFor(household, { apiTokenKey: undefined, source: 'mcp' }));

    if (result.status !== 'proposed') throw new Error(`refused: ${result.reason}`);
    const row = await db.em().findOneOrFail(AssistantProposal, { assistantProposalKey: result.proposal.id }, { filters: false });
    expect(row.source).toBe(AssistantProposalSource.MCP);
    expect(row.status).toBe(AssistantProposalStatus.PENDING);
  });

  it('refuses a transaction of another household and writes nothing', async () => {
    const { groceries, household, mine, otherRow } = await seed();

    const result = await runTool('propose_categorize_transactions', { categoryId: groceries.categoryKey, transactionIds: [mine.transactionKey, otherRow.transactionKey] }, contextFor(household));

    expect(result).toEqual({ reason: 'transaction_unavailable', status: 'refused' });
    expect(await db.em().count(AssistantProposal, {}, { filters: false })).toBe(0);
  });

  it('refuses a transaction on the partner\'s private account', async () => {
    const { household, partnerPrivateRow } = await seed();

    const result = await runTool('propose_update_transaction_note', { note: 'Peek', transactionId: partnerPrivateRow.transactionKey }, contextFor(household));

    expect(result).toEqual({ reason: 'transaction_unavailable', status: 'refused' });
    expect(await db.em().count(AssistantProposal, {}, { filters: false })).toBe(0);
  });

  it('refuses another household\'s category', async () => {
    const { household, mine, otherCategory } = await seed();

    const result = await runTool('propose_categorize_transactions', { categoryId: otherCategory.categoryKey, transactionIds: [mine.transactionKey] }, contextFor(household));

    expect(result).toEqual({ reason: 'category_unavailable', status: 'refused' });
  });

  it('refuses everything for a person who hid AI', async () => {
    const { household, mine } = await seed();
    await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden: true } });

    const result = await runTool('propose_mark_transactions_reviewed', { transactionIds: [mine.transactionKey] }, contextFor(household));

    expect(result).toEqual({ reason: 'ai_hidden', status: 'refused' });
    expect(await db.em().count(AssistantProposal, {}, { filters: false })).toBe(0);
  });
});
