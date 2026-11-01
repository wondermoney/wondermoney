import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * Server-authoritative versioned onboarding bootstrap/completion contract
 * (`GET /v1/user/me/onboarding`, `POST /v1/user/me/onboarding/complete`).
 * This is distinct from the numeric-step endpoints in `useOnboarding.ts` /
 * `useUpdateOnboarding.ts`.
 *
 * The web first-run onboarding wizard (`lib/onboarding/first-run/*`) reports
 * completion to the server through this hook, so `appuser.onboardingCompletedAt`
 * is persisted rather than living only in localStorage: fetch the server's current content
 * version, then complete with that exact version (the endpoint rejects a
 * stale/future version with 400; repeating the same version is an idempotent
 * no-op).
 */

export interface OnboardingBootstrapResponse {
  onboarding: {
    /** True once this user has completed onboarding at any version. */
    completed: boolean;
    completedVersion: null | number;
    /** True when the user still owes the wizard. The inverse of `completed`. */
    required: boolean;
    version: number;
  };
}

async function getOnboardingBootstrap(
  apiClient: AxiosInstance = api,
): Promise<OnboardingBootstrapResponse> {
  const { data } = await apiClient.get<OnboardingBootstrapResponse>(
    "/v1/user/me/onboarding",
  );
  return data;
}

async function completeVersionedOnboarding(
  apiClient: AxiosInstance = api,
) {
  const bootstrap = await getOnboardingBootstrap(apiClient);
  const { data } = await apiClient.post(
    "/v1/user/me/onboarding/complete",
    { version: bootstrap.onboarding.version },
  );
  return data;
}

/**
 * Server-authoritative answer to "does this user still owe the wizard?".
 *
 * The first-run redirect gate must not decide this from `localStorage`, which is
 * empty on any new browser, device or private window — a fully-onboarded user
 * would be sent back through all six steps. This is the only source of truth;
 * `localStorage` is a fast path, not the authority.
 */
export function useOnboardingBootstrap(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () => getOnboardingBootstrap(),
    queryKey: ["onboarding-bootstrap"],
    // The answer only changes when the wizard completes, and that path
    // invalidates explicitly. Refetching on every focus would put a request
    // behind every tab switch for a value that is effectively static.
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export default function useCompleteVersionedOnboarding() {
  return useMutation({
    mutationFn: () => completeVersionedOnboarding(),
    retry: false,
  });
}
