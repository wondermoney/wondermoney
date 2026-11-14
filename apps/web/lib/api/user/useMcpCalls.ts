import { useQuery } from "@tanstack/react-query";

import api from "../api";

/**
 * Recent calls made by an MCP client with one of the member's tokens
 * (`GET /v1/user/mcp-calls`). The server returns the tool name and time only: the audit row
 * never stores amounts or descriptions.
 */
export interface McpCall {
  createdAt: string;
  toolName: string | null;
}

interface McpCallsApiClient {
  get: typeof api.get;
}

const MCP_CALLS_KEY = ["user", "mcp-calls"] as const;

export async function listMcpCalls(
  apiClient: McpCallsApiClient = api,
): Promise<McpCall[]> {
  const { data } = await apiClient.get<{ calls: McpCall[] }>("/v1/user/mcp-calls");
  return data.calls;
}

export function useMcpCalls(enabled = true) {
  return useQuery({
    enabled,
    queryKey: MCP_CALLS_KEY,
    queryFn: () => listMcpCalls(),
  });
}
