import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/** `GET /v1/user/me/profile`: the signed-in person. See the API's `getCurrentUserProfile`. */
export interface Profile {
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

/** True once the profile says this is the shared read-only demo account. */
export function useIsDemoProfile(options?: { fetch?: boolean }): boolean {
  const { data } = useProfile(options);
  return data?.demo === true;
}
