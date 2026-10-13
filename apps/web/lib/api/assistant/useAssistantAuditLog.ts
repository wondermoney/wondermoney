import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AssistantAuditEvent } from "./types";

export interface AssistantAuditLogResponse {
  events: AssistantAuditEvent[];
}

export async function getAssistantAuditLog(
  apiClient: AxiosInstance = api,
): Promise<AssistantAuditLogResponse> {
  const { data } = await apiClient.get<AssistantAuditLogResponse>(
    "/v1/assistant/audit-log",
  );
  return data;
}

export default function useAssistantAuditLog<R = AssistantAuditLogResponse>(
  enabled = false,
  options?: Omit<UseQueryOptions<AssistantAuditLogResponse, Error, R>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery({
    queryKey: ["assistant", "audit-log"],
    queryFn: () => getAssistantAuditLog(),
    enabled,
    ...options,
  });
}
