import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AssistantProposal } from "./types";
import { ASSISTANT_PROPOSALS_KEY } from "./useAssistantProposals";

export type AssistantProposalDecision = "apply" | "reject";

interface AssistantProposalResponse {
  proposal: AssistantProposal;
}

/**
 * Apply or dismiss a proposal. Both are idempotent on the API: deciding twice
 * answers with the proposal as it already is.
 */
export async function decideAssistantProposal(
  proposalId: number,
  decision: AssistantProposalDecision,
  apiClient: AxiosInstance = api,
): Promise<AssistantProposal> {
  const { data } = await apiClient.post<AssistantProposalResponse>(
    `/v1/assistant/proposals/${proposalId}/${decision}`,
  );
  return data.proposal;
}

/** The transaction lists an applied proposal changes. */
const TRANSACTION_KEYS = [
  ["accounts-transactions"],
  ["accounts-transactions-infinite"],
  ["account-transactions"],
  ["account-transaction-review-summary"],
] as const;

function useDecideAssistantProposal(decision: AssistantProposalDecision) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposalId: number) =>
      decideAssistantProposal(proposalId, decision),
    // Settled, not only success: a 409 means the proposal changed state
    // (expired, failed) and the lists should show that.
    onSettled: (_data, error) => {
      void queryClient.invalidateQueries({ queryKey: ASSISTANT_PROPOSALS_KEY });
      if (decision === "apply" && !error) {
        for (const queryKey of TRANSACTION_KEYS) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
    },
  });
}

export function useApplyAssistantProposal() {
  return useDecideAssistantProposal("apply");
}

export function useRejectAssistantProposal() {
  return useDecideAssistantProposal("reject");
}
