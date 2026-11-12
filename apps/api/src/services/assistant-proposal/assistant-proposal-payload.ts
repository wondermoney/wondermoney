import { z } from 'zod';

import { AssistantProposalKind } from '@entity/AssistantProposal';

/** The most transactions one categorize or review proposal may name. */
export const PROPOSAL_TRANSACTION_LIMIT = 100;

/** A pending proposal lapses after this long. */
export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The longest note a proposal may write, the same bound as a note typed in the app. */
export const PROPOSAL_NOTE_MAX_LENGTH = 1000;

const transactionIds = z
  .array(z.number().int().positive())
  .min(1)
  .max(PROPOSAL_TRANSACTION_LIMIT)
  .transform((ids) => [...new Set(ids)]);

export const categorizeTransactionsPayloadSchema = z.object({
  categoryId: z.number().int().positive(),
  transactionIds,
}).strict();

export const markTransactionsReviewedPayloadSchema = z.object({
  transactionIds,
}).strict();

export const updateTransactionNotePayloadSchema = z.object({
  /** An empty (or null) note clears it. */
  note: z.string().trim().max(PROPOSAL_NOTE_MAX_LENGTH).nullable().transform((note) => (note ? note : null)),
  transactionId: z.number().int().positive(),
}).strict();

export type CategorizeTransactionsPayload = z.infer<typeof categorizeTransactionsPayloadSchema>;
export type MarkTransactionsReviewedPayload = z.infer<typeof markTransactionsReviewedPayloadSchema>;
export type ProposalPayload =
  | { kind: AssistantProposalKind.CATEGORIZE_TRANSACTIONS; payload: CategorizeTransactionsPayload }
  | { kind: AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED; payload: MarkTransactionsReviewedPayload }
  | { kind: AssistantProposalKind.UPDATE_TRANSACTION_NOTE; payload: UpdateTransactionNotePayload };

export type UpdateTransactionNotePayload = z.infer<typeof updateTransactionNotePayloadSchema>;

/**
 * Read a stored payload back through its kind's schema. The column is jsonb, so a row written by
 * an older release, or edited by hand, is checked again rather than trusted; a payload that no
 * longer parses throws, and the caller treats the proposal as unusable.
 */
export function parseProposalPayload(kind: AssistantProposalKind, payload: unknown): ProposalPayload {
  switch (kind) {
    case AssistantProposalKind.CATEGORIZE_TRANSACTIONS:
      return { kind, payload: categorizeTransactionsPayloadSchema.parse(payload) };
    case AssistantProposalKind.MARK_TRANSACTIONS_REVIEWED:
      return { kind, payload: markTransactionsReviewedPayloadSchema.parse(payload) };
    case AssistantProposalKind.UPDATE_TRANSACTION_NOTE:
      return { kind, payload: updateTransactionNotePayloadSchema.parse(payload) };
  }
}

/** Every transaction a payload names. */
export function transactionIdsOf(parsed: ProposalPayload): number[] {
  return parsed.kind === AssistantProposalKind.UPDATE_TRANSACTION_NOTE ? [parsed.payload.transactionId] : parsed.payload.transactionIds;
}
