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
 * Enable Banking's real API before being saved.
 *
 * The private key itself never appears in any response shape here — the API
 * only ever hands back the (non-secret) `applicationId` plus validation
 * status. Nothing in this module should ever receive or hold the raw PEM
 * outside of `SaveEnableBankingCredentialInput`, which is sent once and
 * discarded.
 */

export type EnableBankingCredentialStatus =
  "active" | "invalid" | "pending" | "revoked";

export interface EnableBankingCredential {
  /** Null only while the sole credential is a generated key waiting for its application ID. */
  applicationId: string | null;
  status: EnableBankingCredentialStatus;
  lastValidatedAt: string | null; // date
  lastValidationError: string | null;
  /**
   * A key the server generated, waiting for its application ID, and when it lapses. Absent on
   * an API older than generated keys.
   */
  pending?: { expiresAt: string } | null;
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

/** `POST /v1/user/enable-banking-credential/certificate`: the certificate to register. */
export interface EnableBankingCertificate {
  certificatePem: string;
  /** When the generated key lapses if it is not activated. */
  expiresAt: string;
}

/**
 * Every change to the key (pasting, removing, both generated-key steps) needs a fresh session,
 * and the authenticator code when 2FA is on. The code is sent once, in a header, never stored.
 */
export interface SensitiveRequestInput {
  totpCode?: string;
}

interface SensitiveRequestConfig {
  headers: { "x-totp-code": string };
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
    config?: SensitiveRequestConfig,
  ) => Promise<{ data: T }>;
}

export interface EnableBankingCredentialDeleteClient {
  delete: (url: string, config?: SensitiveRequestConfig) => Promise<unknown>;
}

const sensitiveHeaders = (
  input: SensitiveRequestInput,
): SensitiveRequestConfig | undefined =>
  input.totpCode ? { headers: { "x-totp-code": input.totpCode } } : undefined;

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
  input: SaveEnableBankingCredentialInput & SensitiveRequestInput,
  apiClient: EnableBankingCredentialPostClient = api,
): Promise<SaveEnableBankingCredentialResponse> {
  const { data } = await apiClient.post<SaveEnableBankingCredentialResponse>(
    "/v1/user/enable-banking-credential",
    { applicationId: input.applicationId, privateKeyPem: input.privateKeyPem },
    sensitiveHeaders(input),
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
  SaveEnableBankingCredentialInput & SensitiveRequestInput
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

/**
 * Asks the server to generate a key pair and answers its certificate. The private key stays on
 * the server; calling this again replaces a key still waiting for its application ID.
 */
export async function createEnableBankingCertificate(
  input: SensitiveRequestInput = {},
): Promise<EnableBankingCertificate> {
  const { data } = await api.post<EnableBankingCertificate>(
    "/v1/user/enable-banking-credential/certificate",
    undefined,
    sensitiveHeaders(input),
  );
  return data;
}

export function useCreateEnableBankingCertificate() {
  const queryClient = useQueryClient();
  return useMutation<
    EnableBankingCertificate,
    EnableBankingCredentialApiError,
    SensitiveRequestInput
  >({
    mutationFn: (input) => createEnableBankingCertificate(input),
    scope: { id: "enable-banking-credential" },
    onSuccess: (created) => {
      // The new key is the pending one straight away, so a caller comparing its certificate with
      // the server's pending key (the setup wizard) never sees them disagree while this refetches.
      queryClient.setQueryData<EnableBankingCredentialResponse>(
        enableBankingCredentialQueryKeys.all,
        (current) => ({
          applicationId: current?.applicationId ?? null,
          lastValidatedAt: current?.lastValidatedAt ?? null,
          lastValidationError: current?.lastValidationError ?? null,
          status: current?.status ?? "pending",
          pending: { expiresAt: created.expiresAt },
        }),
      );
      return queryClient.invalidateQueries({
        queryKey: enableBankingCredentialQueryKeys.all,
      });
    },
  });
}

/** Activates the generated key under the application ID Enable Banking gave its certificate. */
export async function activateEnableBankingCredential(
  input: SensitiveRequestInput & { applicationId: string },
): Promise<EnableBankingCredential> {
  const { data } = await api.post<EnableBankingCredential>(
    "/v1/user/enable-banking-credential/activate",
    { applicationId: input.applicationId },
    sensitiveHeaders(input),
  );
  return data;
}

export function useActivateEnableBankingCredential() {
  const queryClient = useQueryClient();
  return useMutation<
    EnableBankingCredential,
    EnableBankingCredentialApiError,
    SensitiveRequestInput & { applicationId: string }
  >({
    mutationFn: (input) => activateEnableBankingCredential(input),
    scope: { id: "enable-banking-credential" },
    // Settled, not only on success: a refusal can mean the pending key lapsed or was replaced.
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: enableBankingCredentialQueryKeys.all,
      }),
  });
}

export async function deleteEnableBankingCredential(
  input: SensitiveRequestInput = {},
  apiClient: EnableBankingCredentialDeleteClient = api,
): Promise<unknown> {
  return apiClient.delete(
    "/v1/user/enable-banking-credential",
    sensitiveHeaders(input),
  );
}

export function getDeleteEnableBankingCredentialMutationOptions(
  queryClient: EnableBankingCredentialCache,
  apiClient: EnableBankingCredentialDeleteClient = api,
): UseMutationOptions<
  unknown,
  EnableBankingCredentialApiError,
  SensitiveRequestInput
> {
  return {
    mutationFn: (input) => deleteEnableBankingCredential(input, apiClient),
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
