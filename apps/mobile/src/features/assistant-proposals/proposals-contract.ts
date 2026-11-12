import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Changes the assistant or an MCP client proposed, which the person applies or dismisses
 * (`/v1/assistant/proposals`). Nothing changes until the person applies one here or on web.
 *
 * Response enums are tolerant: a kind or field a newer server adds reads as `unknown`, so one
 * proposal this build cannot describe does not fail the whole list.
 */

export const PROPOSAL_KINDS = ['categorize_transactions', 'mark_transactions_reviewed', 'update_transaction_note'] as const
export const PROPOSAL_STATUSES = ['pending', 'applied', 'rejected', 'expired', 'failed'] as const

export type ProposalKind = (typeof PROPOSAL_KINDS)[number] | 'unknown'
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number] | 'unknown'

const positiveId = z.number().int().positive().safe()

const proposalChangeSchema = z.object({
  transactionId: positiveId,
  description: z.string().nullable(),
  transactionDate: z.string().nullable(),
  field: tolerantEnum(['category', 'reviewed', 'note'], 'unknown'),
  /** The current value, read when the server built the response. */
  before: z.union([z.string(), z.boolean(), z.null()]),
  /** The proposed value. */
  after: z.union([z.string(), z.boolean(), z.null()]),
})

export const proposalSchema = z.object({
  id: positiveId,
  kind: tolerantEnum(PROPOSAL_KINDS, 'unknown'),
  source: tolerantEnum(['assistant', 'mcp'], 'unknown'),
  status: tolerantEnum(PROPOSAL_STATUSES, 'unknown'),
  summary: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  changes: z.array(proposalChangeSchema),
  unavailableCount: z.number().int().nonnegative(),
})

export type ProposalDto = z.infer<typeof proposalSchema>
export type ProposalChangeDto = z.infer<typeof proposalChangeSchema>

/** At most this many pending proposals are read: the badge and the list. */
export const PENDING_PROPOSALS_LIMIT = 100

export const pendingProposalsEndpoint = readEndpoint({
  method: 'GET',
  path: `/v1/assistant/proposals?status=pending&limit=${PENDING_PROPOSALS_LIMIT}`,
  schema: z.object({ proposals: z.array(proposalSchema) }),
})

export type ProposalDecision = 'apply' | 'reject'

const decisionResponseSchema = z.object({ proposal: proposalSchema })

export const createProposalDecisionEndpoint = (proposalId: number, decision: ProposalDecision) => {
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) throw new Error('A positive proposal id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/assistant/proposals/${proposalId}/${decision}`,
    schema: decisionResponseSchema,
  })
}
