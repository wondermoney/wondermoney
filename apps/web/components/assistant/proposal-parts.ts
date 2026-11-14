import type {
  AssistantProposal,
  AssistantProposalToolData,
} from "@/lib/api/assistant/types";

/** The `propose_*` tools, as their parts are named in the chat stream (`tool-<name>`). */
const PROPOSAL_TOOL_PART = /^tool-propose_/;

/**
 * The proposal a chat message part carries, or null.
 *
 * Only a finished `propose_*` tool call that actually created a proposal
 * yields one; a refused proposal (AI hidden, a transaction the person cannot
 * see) shows nothing, and the model's own text explains it.
 */
export function proposalFromPart(part: {
  type: string;
}): AssistantProposal | null {
  if (!PROPOSAL_TOOL_PART.test(part.type)) return null;
  const { output, state } = part as { output?: unknown; state?: unknown };
  if (state !== "output-available" || !output || typeof output !== "object")
    return null;
  const data = (output as { data?: AssistantProposalToolData }).data;
  if (!data || data.status !== "proposed" || !data.proposal) return null;
  return data.proposal;
}
