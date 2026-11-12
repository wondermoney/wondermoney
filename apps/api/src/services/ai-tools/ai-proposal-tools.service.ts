import { z } from 'zod';

import { DI } from '@app/app';
import { AssistantProposalKind, AssistantProposalSource } from '@entity/AssistantProposal';
import {
  categorizeTransactionsPayloadSchema,
  markTransactionsReviewedPayloadSchema,
  PROPOSAL_NOTE_MAX_LENGTH,
  PROPOSAL_TRANSACTION_LIMIT,
  type ProposalPayload,
  updateTransactionNotePayloadSchema,
} from '@service/assistant-proposal/assistant-proposal-payload';
import { createProposal, type CreateProposalResult } from '@service/assistant-proposal/assistant-proposal.service';

import type { AiToolContext, AiToolDefinition, AiToolName, AiToolResult } from './ai-tool-types';
import { loadAiToolViewer } from './ai-tool-viewer';

const NOT_APPLIED = 'Nothing changes until the person applies it in WonderMoney; you cannot apply it yourself. Tell them a proposal is waiting for their confirmation, never that the change was made.';

/*
 * The tool input schemas stay plain (no transforms) so the MCP SDK can describe them as JSON
 * Schema; the payload schemas then normalise the input (de-duplicated ids, a trimmed note).
 */
const transactionIdsInput = z
  .array(z.number().int().positive())
  .min(1)
  .max(PROPOSAL_TRANSACTION_LIMIT)
  .describe(`Transaction ids from search_transactions, at most ${PROPOSAL_TRANSACTION_LIMIT}.`);

function defineProposalTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: AiToolName,
  description: string,
  inputSchema: S,
  toPayload: (input: z.infer<S>) => ProposalPayload,
): AiToolDefinition<z.infer<S>, CreateProposalResult> {
  return {
    description,
    execute: async (input, context) => propose(context, toPayload(input)),
    inputSchema,
    name,
  };
}

async function propose(context: AiToolContext, payload: ProposalPayload): Promise<AiToolResult<CreateProposalResult>> {
  const viewer = await loadAiToolViewer(context);
  if (!viewer) {
    return { data: { reason: 'transaction_unavailable', status: 'refused' }, dataUsed: { granularity: 'proposal', recordCount: 0, source: 'database' } };
  }
  const origin = context.origin?.source === 'mcp'
    ? { apiTokenKey: context.origin.apiTokenKey, source: AssistantProposalSource.MCP }
    : { source: AssistantProposalSource.ASSISTANT };
  const data = await createProposal(DI.em, viewer, origin, payload);
  return {
    data,
    dataUsed: { granularity: 'proposal', recordCount: data.status === 'proposed' ? data.proposal.changes.length : 0, source: 'database' },
  };
}

/**
 * The `propose_*` tools: each drafts one `AssistantProposal` for the caller to confirm, after
 * checking that every transaction (and the category) is one they can see and use. They never
 * write a transaction, a category link or an audit row; applying is the person's own step in the
 * app (`POST /v1/assistant/proposals/:id/apply`), which no API token or MCP client can take.
 */
export const AI_PROPOSAL_TOOL_DEFINITIONS: readonly AiToolDefinition<never>[] = [
  defineProposalTool(
    'propose_categorize_transactions',
    `Propose putting one category on up to ${PROPOSAL_TRANSACTION_LIMIT} transactions. Use ids from search_transactions and a category id from list_categories. Returns the proposal id, a summary and a before/after preview. ${NOT_APPLIED}`,
    z.object({
      categoryId: z.number().int().positive().describe('The category id, from list_categories.'),
      transactionIds: transactionIdsInput,
    }),
    (input) => ({ kind: AssistantProposalKind.CATEGORIZE_TRANSACTIONS, payload: categorizeTransactionsPayloadSchema.parse(input) }),
  ),
  defineProposalTool(
    'propose_mark_transactions_reviewed',
    `Propose marking up to ${PROPOSAL_TRANSACTION_LIMIT} transactions as reviewed. Use ids from search_transactions. Returns the proposal id, a summary and a preview. ${NOT_APPLIED}`,
    z.object({ transactionIds: transactionIdsInput }),
    (input) => ({ kind: AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED, payload: markTransactionsReviewedPayloadSchema.parse(input) }),
  ),
  defineProposalTool(
    'propose_update_transaction_note',
    `Propose setting the note on one transaction (an empty note clears it). Use an id from search_transactions. Returns the proposal id, a summary and a before/after preview. ${NOT_APPLIED}`,
    z.object({
      note: z.string().max(PROPOSAL_NOTE_MAX_LENGTH).describe(`The new note, at most ${PROPOSAL_NOTE_MAX_LENGTH} characters. Empty clears it.`),
      transactionId: z.number().int().positive().describe('The transaction id, from search_transactions.'),
    }),
    (input) => ({ kind: AssistantProposalKind.UPDATE_TRANSACTION_NOTE, payload: updateTransactionNotePayloadSchema.parse(input) }),
  ),
];

export const AI_PROPOSAL_TOOL_NAMES = AI_PROPOSAL_TOOL_DEFINITIONS.map((definition) => definition.name);
