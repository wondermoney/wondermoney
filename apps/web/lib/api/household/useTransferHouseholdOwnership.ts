import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { householdQueryKeys } from "./queryKeys";
import type {
  Household,
  HouseholdApiError,
  HouseholdResponse,
} from "./types";
import { normalizeHousehold } from "./useHousehold";

export interface HouseholdTransferClient {
  post: <T>(url: string, body: unknown) => Promise<{ data: T }>;
}

/** Makes `appuserKey` the owner; the caller (the owner) becomes an admin. */
export async function transferHouseholdOwnership(
  appuserKey: number,
  apiClient: HouseholdTransferClient = api,
): Promise<Household> {
  const { data } = await apiClient.post<HouseholdResponse>(
    "/v1/household/transfer-ownership",
    { appuserKey },
  );
  return normalizeHousehold(data);
}

type HouseholdCache = Pick<QueryClient, "invalidateQueries" | "setQueryData">;

export function getTransferHouseholdOwnershipMutationOptions(
  queryClient: HouseholdCache,
  apiClient: HouseholdTransferClient = api,
): UseMutationOptions<Household, HouseholdApiError, number> {
  return {
    mutationFn: (appuserKey) =>
      transferHouseholdOwnership(appuserKey, apiClient),
    scope: { id: "household" },
    onSuccess: (household) => {
      queryClient.setQueryData(householdQueryKeys.all, household);
      // The caller is no longer the owner, and owner-only controls live on
      // other screens too (the private-account switch, data restore), so
      // nothing cached about what they may do is safe to keep.
      return queryClient.invalidateQueries();
    },
  };
}

export default function useTransferHouseholdOwnership() {
  const queryClient = useQueryClient();
  return useMutation(getTransferHouseholdOwnershipMutationOptions(queryClient));
}
