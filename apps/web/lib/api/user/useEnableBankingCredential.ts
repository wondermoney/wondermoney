import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosError } from "axios";

import api from "../api";

/**
 * BYOK Enable Banking credential — the user's own Enable Banking application
 * registration (Application ID + private key), validated server-side against
 * Enable Banking's real API before being saved. See
 * `/Users/dc/.claude/plans/sunny-splashing-cook.md` §2/§6.
 *
 * The private key itself never appears in any response shape here — the API
 * only ever hands back the (non-secret) `applicationId` plus validation
 * status. Nothing in this module should ever receive or hold the raw PEM
 * outside of `SaveEnableBankingCredentialInput`, which is sent once and
 * discarded.
 */

export type EnableBankingCredentialStatus = "active" | "invalid" | "revoked";

export interface EnableBankingCredential {
  applicationId: string;
  status: EnableBankingCredentialStatus;
  lastValidatedAt: string | null; // date
  lastValidationError: string | null;
}

/** `null` when the user has no credential configured yet. */
export type EnableBankingCredentialResponse = EnableBankingCredential | null;

export interface SaveEnableBankingCredentialInput {
  applicationId: string;
  privateKeyPem: string;
}

export interface SaveEnableBankingCredentialResponse {
  applicationId: string;
  status: "active";
  lastValidatedAt: string; // date
}

export interface EnableBankingCredentialErrorBody {
  code?: string;
  message?: string;
}

export type EnableBankingCredentialApiError =
  AxiosError<EnableBankingCredentialErrorBody>;

export const enableBankingCredentialQueryKeys = {
  all: ["enable-banking-credential"] as const,
};

export interface EnableBankingCredentialGetClient {
  get: <T>(url: string) => Promise<{ data: T }>;
}

export interface EnableBankingCredentialPostClient {
  post: <T>(
    url: string,
    input: SaveEnableBankingCredentialInput,
  ) => Promise<{ data: T }>;
}

export interface EnableBankingCredentialDeleteClient {
  delete: (url: string) => Promise<unknown>;
}

export async function getEnableBankingCredential(
  apiClient: EnableBankingCredentialGetClient = api,
): Promise<EnableBankingCredentialResponse> {
  const { data } = await apiClient.get<EnableBankingCredentialResponse>(
    "/v1/user/enable-banking-credential",
  );
  return data;
}

export default function useEnableBankingCredential<
  R = EnableBankingCredentialResponse,
>(
  options?: Omit<
    UseQueryOptions<
      EnableBankingCredentialResponse,
      EnableBankingCredentialApiError,
      R
    >,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: enableBankingCredentialQueryKeys.all,
    queryFn: () => getEnableBankingCredential(),
    ...options,
  });
}

export async function saveEnableBankingCredential(
  input: SaveEnableBankingCredentialInput,
  apiClient: EnableBankingCredentialPostClient = api,
): Promise<SaveEnableBankingCredentialResponse> {
  const { data } = await apiClient.post<SaveEnableBankingCredentialResponse>(
    "/v1/user/enable-banking-credential",
    input,
  );
  return data;
}

type EnableBankingCredentialCache = Pick<QueryClient, "invalidateQueries">;

export function getSaveEnableBankingCredentialMutationOptions(
  queryClient: EnableBankingCredentialCache,
  apiClient: EnableBankingCredentialPostClient = api,
): UseMutationOptions<
  SaveEnableBankingCredentialResponse,
  EnableBankingCredentialApiError,
  SaveEnableBankingCredentialInput
> {
  return {
    mutationFn: (input) => saveEnableBankingCredential(input, apiClient),
    scope: { id: "enable-banking-credential" },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: enableBankingCredentialQueryKeys.all,
      }),
  };
}

export function useSaveEnableBankingCredential() {
  const queryClient = useQueryClient();
  return useMutation(
    getSaveEnableBankingCredentialMutationOptions(queryClient),
  );
}

export async function deleteEnableBankingCredential(
  apiClient: EnableBankingCredentialDeleteClient = api,
): Promise<unknown> {
  return apiClient.delete("/v1/user/enable-banking-credential");
}

export function getDeleteEnableBankingCredentialMutationOptions(
  queryClient: EnableBankingCredentialCache,
  apiClient: EnableBankingCredentialDeleteClient = api,
): UseMutationOptions<unknown, EnableBankingCredentialApiError, void> {
  return {
    mutationFn: () => deleteEnableBankingCredential(apiClient),
    scope: { id: "enable-banking-credential" },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: enableBankingCredentialQueryKeys.all,
      }),
  };
}

export function useDeleteEnableBankingCredential() {
  const queryClient = useQueryClient();
  return useMutation(
    getDeleteEnableBankingCredentialMutationOptions(queryClient),
  );
}
