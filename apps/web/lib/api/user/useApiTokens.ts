import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../api";

/**
 * Personal API tokens (`/v1/user/api-tokens`).
 *
 * The plain token is returned only by `POST`, once. Everything the list shows afterwards is
 * the display prefix and metadata; the server stores a SHA-256 hash and cannot return the
 * token again.
 */
export type ApiTokenScope = "read" | "write" | "calendar:read" | "mcp:read" | "mcp:propose";

export interface ApiToken {
  createdAt: string;
  expiresAt: string;
  id: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  name: string;
  prefix: string;
  revokedAt: string | null;
  scopes: ApiTokenScope[];
}

export interface CreateApiTokenInput {
  expiresInDays: 30 | 90 | 365;
  name: string;
  scopes: ApiTokenScope[];
  /** Required only when the account has TOTP enabled. */
  totpCode?: string;
}

export interface CreatedApiToken {
  apiToken: ApiToken;
  token: string;
}

interface ApiTokenApiClient {
  delete: typeof api.delete;
  get: typeof api.get;
  post: typeof api.post;
}

const API_TOKENS_KEY = ["user", "api-tokens"] as const;

export async function listApiTokens(
  apiClient: ApiTokenApiClient = api,
): Promise<ApiToken[]> {
  const { data } = await apiClient.get<{ apiTokens: ApiToken[] }>(
    "/v1/user/api-tokens",
  );
  return data.apiTokens;
}

export async function createApiToken(
  input: CreateApiTokenInput,
  apiClient: ApiTokenApiClient = api,
): Promise<CreatedApiToken> {
  const { data } = await apiClient.post<CreatedApiToken>(
    "/v1/user/api-tokens",
    {
      expiresInDays: input.expiresInDays,
      name: input.name,
      scopes: input.scopes,
    },
    input.totpCode ? { headers: { "x-totp-code": input.totpCode } } : undefined,
  );
  return data;
}

export async function revokeApiToken(
  id: number,
  apiClient: ApiTokenApiClient = api,
): Promise<void> {
  await apiClient.delete(`/v1/user/api-tokens/${id}`);
}

export function useApiTokens() {
  return useQuery({
    queryKey: API_TOKENS_KEY,
    queryFn: () => listApiTokens(),
  });
}

export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) => createApiToken(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY });
    },
  });
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => revokeApiToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY });
    },
  });
}
