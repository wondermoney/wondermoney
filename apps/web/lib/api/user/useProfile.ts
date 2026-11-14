import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/** Where PDF statement pages go, for the consent line (`useStatementImportProvider`). */
export interface StatementImportProvider {
  kind: "anthropic" | "azure-openai" | "openai-compatible";
  name: string | null;
}

/**
 * `GET /v1/user/me/profile`: the signed-in person. See the API's `getCurrentUserProfile`. Every
 * reader shares this one cached query and picks its field with `select` (`useProfileField`).
 */
export interface Profile {
  aiProviders?: { statementImport?: StatementImportProvider | null };
  /**
   * `instance` when this person's household may link a bank with the server's shared Enable
   * Banking credential, so no key of their own is needed; `user` when they need their own.
   * Absent on an older API.
   */
  bankSyncCredentials?: "instance" | "user";
  /** True for the shared read-only demo account. Absent on an older API, which reads as false. */
  demo?: boolean;
  emailAddress: string;
  firstName: string;
  lastName: null | string;
  mfaEnabled: boolean;
}

export const profileQueryKey = ["user", "me", "profile"] as const;

export async function getProfile(
  apiClient: AxiosInstance = api,
): Promise<Profile> {
  const { data } = await apiClient.get<{ profile: Profile }>(
    "/v1/user/me/profile",
  );
  return data.profile;
}

/**
 * The signed-in person's profile. Only for signed-in screens: signed out it is a 401.
 * `fetch: false` reads what another observer on the screen loaded (the shell's demo banner)
 * without requesting it again.
 */
export default function useProfile({ fetch = true }: { fetch?: boolean } = {}) {
  return useQuery({
    enabled: fetch,
    queryFn: () => getProfile(),
    queryKey: profileQueryKey,
    // Whether this is the demo account does not change within a session.
    staleTime: 5 * 60 * 1000,
  });
}

/** One field of the profile, from the shared query. */
export function useProfileField<R>(
  select: (profile: Profile) => R,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: options.enabled,
    queryFn: () => getProfile(),
    queryKey: profileQueryKey,
    select,
    staleTime: 5 * 60 * 1000,
  });
}

/** True once the profile says this is the shared read-only demo account. */
export function useIsDemoProfile(options?: { fetch?: boolean }): boolean {
  const { data } = useProfile(options);
  return data?.demo === true;
}
