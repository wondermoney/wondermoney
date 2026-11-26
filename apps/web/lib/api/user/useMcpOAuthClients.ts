import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../api";

/**
 * The OAuth clients (ChatGPT and the like) the member let into the MCP server
 * (`GET /v1/user/mcp-clients`), and revoking one (`DELETE /v1/user/mcp-clients/:clientId`):
 * the client's next call is refused.
 */
export interface McpOAuthClient {
  clientId: string;
  connectedAt: string;
  lastUsedAt: string | null;
  /** Self-declared at registration, so the settings list shows where it redirects beside it. */
  name: string | null;
  /** Every registered redirect's scheme and host: `https://chatgpt.com`, `http://127.0.0.1:8976`. */
  redirectOrigins: string[];
  scopes: string[];
}

interface McpOAuthClientsApiClient {
  delete: typeof api.delete;
  get: typeof api.get;
}

export const MCP_OAUTH_CLIENTS_KEY = ["user", "mcp-clients"] as const;

export async function listMcpOAuthClients(
  apiClient: McpOAuthClientsApiClient = api,
): Promise<McpOAuthClient[]> {
  const { data } = await apiClient.get<{ clients: McpOAuthClient[] }>(
    "/v1/user/mcp-clients",
  );
  return data.clients;
}

export async function revokeMcpOAuthClient(
  clientId: string,
  apiClient: McpOAuthClientsApiClient = api,
): Promise<void> {
  await apiClient.delete(
    `/v1/user/mcp-clients/${encodeURIComponent(clientId)}`,
  );
}

export function useMcpOAuthClients(enabled = true) {
  return useQuery({
    enabled,
    queryKey: MCP_OAUTH_CLIENTS_KEY,
    queryFn: () => listMcpOAuthClients(),
  });
}

export function useRevokeMcpOAuthClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => revokeMcpOAuthClient(clientId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MCP_OAUTH_CLIENTS_KEY }),
  });
}
