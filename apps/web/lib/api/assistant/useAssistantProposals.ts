import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AssistantProposal, AssistantProposalStatus } from "./types";

export interface AssistantProposalsResponse {
  proposals: AssistantProposal[];
}

/** The query key every proposal list shares, so a decision can refresh them all. */
export const ASSISTANT_PROPOSALS_KEY = ["assistant", "proposals"] as const;

export async function getAssistantProposals(
  status: AssistantProposalStatus = "pending",
  apiClient: AxiosInstance = api,
): Promise<AssistantProposalsResponse> {
  const { data } = await apiClient.get<AssistantProposalsResponse>(
    "/v1/assistant/proposals",
    { params: { status } },
  );
  return data;
}

export default function useAssistantProposals<R = AssistantProposalsResponse>(
  status: AssistantProposalStatus = "pending",
  options?: Omit<
    UseQueryOptions<AssistantProposalsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: [...ASSISTANT_PROPOSALS_KEY, status],
    queryFn: () => getAssistantProposals(status),
    ...options,
  });
}
