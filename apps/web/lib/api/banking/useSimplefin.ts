import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";
import type { InstanceDescription } from "@/lib/api/instance/useInstance";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

/**
 * SimpleFIN Bridge (`/v1/banking/simplefin`, apps/api `controller/banking-simplefin.ts`): US and
 * Canadian banks through a setup token the person makes at their SimpleFIN Bridge account. The API
 * claims the token once and keeps the access it gets back encrypted; neither ever comes back.
 */

/** Where a person gets a setup token. */
export const SIMPLEFIN_BRIDGE_URL = "https://bridge.simplefin.org/";

/** The operator turned SimpleFIN on (`BANK_PROVIDERS` includes `simplefin`; off by default). */
export function isSimplefinEnabled(
  features: InstanceDescription["features"],
): boolean {
  return features.bankSyncProviders?.includes("simplefin") ?? false;
}

export interface ConnectSimplefinResponse {
  connectionId: number;
  /** The first sync's incident, when it was queued. */
  incidentId: string | null;
}

export async function connectSimplefin(
  setupToken: string,
  apiClient: Pick<AxiosInstance, "post"> = api,
): Promise<ConnectSimplefinResponse> {
  const { data } = await apiClient.post<ConnectSimplefinResponse>(
    "/v1/banking/simplefin/connections",
    { setupToken },
  );
  return data;
}

export async function disconnectSimplefin(
  connectionId: number,
  apiClient: Pick<AxiosInstance, "delete"> = api,
): Promise<void> {
  await apiClient.delete(`/v1/banking/simplefin/connections/${connectionId}`);
}

/** The connection list and everything that shows accounts. */
async function invalidateConnections(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["banking", "connections"] }),
    queryClient.invalidateQueries({ queryKey: ["banking", "alerts"] }),
    invalidateAccounts(queryClient),
  ]);
}

/**
 * Claims a setup token. `gcTime: 0` drops the finished mutation, and with it the token it was
 * called with, from the mutation cache as soon as nothing observes it.
 */
export function useConnectSimplefin() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (setupToken: string) => connectSimplefin(setupToken),
    onSuccess: () => invalidateConnections(queryClient),
  });
}

export function useDisconnectSimplefin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: number) => disconnectSimplefin(connectionId),
    onSuccess: () => invalidateConnections(queryClient),
  });
}
