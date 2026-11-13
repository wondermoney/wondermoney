import { useMutation, type UseMutationOptions } from "@tanstack/react-query";

import api from "../api";
import type { HouseholdApiError } from "./types";

export interface HouseholdAcceptClient {
  post: <T>(url: string) => Promise<{ data: T }>;
}

/**
 * The explicit confirmation by a signed-in account: it leaves its current
 * household (which must hold no accounts or transactions) for the inviting one.
 */
export async function acceptHouseholdInvite(
  token: string,
  apiClient: HouseholdAcceptClient = api,
): Promise<void> {
  await apiClient.post<void>(
    `/v1/household/invites/${encodeURIComponent(token)}/accept`,
  );
}

/** Opens the app home with a full page load, so no cache from the old household survives. */
export function reloadIntoApp(locale: string): void {
  // A full load on purpose, not a router push: the shell and its providers
  // must start over in the new household.
  window.location.assign(
    new URL(`/${locale}`, window.location.origin).toString(),
  );
}

export function getAcceptHouseholdInviteMutationOptions(
  locale: string,
  apiClient: HouseholdAcceptClient = api,
  onJoined: (locale: string) => void = reloadIntoApp,
): UseMutationOptions<void, HouseholdApiError, string> {
  return {
    mutationFn: (token) => acceptHouseholdInvite(token, apiClient),
    scope: { id: "household" },
    // Every cached query belongs to the household the user just left.
    onSuccess: () => onJoined(locale),
  };
}

export default function useAcceptHouseholdInvite(locale: string) {
  return useMutation(getAcceptHouseholdInviteMutationOptions(locale));
}
