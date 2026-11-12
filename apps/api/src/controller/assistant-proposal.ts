import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { authedContext } from '@middleware/authed-context';
import { isAiHidden } from '@service/ai/ai-availability';
import { applyProposal, listProposals, type ProposalViewer, rejectProposal } from '@service/assistant-proposal/assistant-proposal.service';
import { ERROR_CODE, ForbiddenError } from '@utils/errors';
import { assistantProposalListQuerySchema, assistantProposalParamsSchema } from '@validators/assistant';
import { zParse } from '@validators/parser';

/**
 * `GET /v1/assistant/proposals?status=pending` — the signed-in member's proposals, newest first,
 * each with a live before/after preview of what it would change.
 */
export async function listAssistantProposals(req: Request, res: Response) {
  const viewer = proposalViewer(req);
  const { query: { limit, status } } = await zParse(assistantProposalListQuerySchema, req);
  const proposals = await listProposals(DI.em, viewer, { limit, status });
  return res.json({ proposals });
}

/**
 * `POST /v1/assistant/proposals/:proposalId/apply` — make the change, through the same services
 * as the ordinary transaction endpoints. Idempotent; only a signed-in person can apply, never an
 * API token or MCP client.
 */
export async function applyAssistantProposal(req: Request, res: Response) {
  const viewer = proposalViewer(req, { personOnly: true });
  const { params: { proposalId } } = await zParse(assistantProposalParamsSchema, req);
  const proposal = await applyProposal(DI.em, viewer, proposalId);
  return res.json({ proposal });
}

/** `POST /v1/assistant/proposals/:proposalId/reject` — dismiss it. Idempotent. */
export async function rejectAssistantProposal(req: Request, res: Response) {
  const viewer = proposalViewer(req, { personOnly: true });
  const { params: { proposalId } } = await zParse(assistantProposalParamsSchema, req);
  const proposal = await rejectProposal(DI.em, viewer, proposalId);
  return res.json({ proposal });
}

/**
 * The member, refused when they hid AI (proposals are an AI feature, so they disappear with it) and,
 * for a decision, when the request carries an API token. The token policy already keeps every token
 * off these POST routes; this repeats it where the decision is made.
 */
function proposalViewer(req: Request, options: { personOnly?: boolean } = {}): ProposalViewer {
  const { tenant, user } = authedContext(req);
  if (options.personOnly && req.apiToken) {
    throw new ForbiddenError('Only you can apply or dismiss a proposal, in the app.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED);
  }
  if (isAiHidden(user)) {
    throw new ForbiddenError('AI features are turned off for this account.', ERROR_CODE.FEATURE_DISABLED);
  }
  return { appuser: user, tenant };
}
