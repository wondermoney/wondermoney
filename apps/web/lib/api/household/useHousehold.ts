import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type {
  Household,
  HouseholdApiError,
  HouseholdResponse,
} from "./types";

export interface HouseholdGetClient {
  get: <T>(url: string) => Promise<{ data: T }>;
}

/**
 * An API from before roles allowed one partner beside the owner, so a missing cap
 * means two seats; the current API always sends `maxMembers`.
 */
const LEGACY_MAX_MEMBERS = 2;

/**
 * Resolves the fields an older API leaves out: `pendingInvites` falls back to the
 * deprecated single `pendingInvite` (as a member invite, the only kind it knew).
 */
export function normalizeHousehold(raw: HouseholdResponse): Household {
  const legacyInvite = raw.pendingInvite
    ? [{ ...raw.pendingInvite, role: raw.pendingInvite.role ?? "member" } as const]
    : [];
  return {
    maxMembers: raw.maxMembers ?? LEGACY_MAX_MEMBERS,
    members: raw.members,
    pendingInvites: raw.pendingInvites ?? legacyInvite,
    viewerAppuserKey: raw.viewerAppuserKey ?? null,
  };
}

export async function getHousehold(
  apiClient: HouseholdGetClient = api,
): Promise<Household> {
  const { data } = await apiClient.get<HouseholdResponse>("/v1/household");
  return normalizeHousehold(data);
}

export default function useHousehold<R = Household>(
  options?: Omit<
    UseQueryOptions<Household, HouseholdApiError, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: householdQueryKeys.all,
    queryFn: () => getHousehold(),
    ...options,
  });
}
