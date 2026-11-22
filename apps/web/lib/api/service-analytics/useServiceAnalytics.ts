import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../api";

/**
 * The person's choice about service analytics: the pseudonymous events the API records for every
 * user of a server that sends them (the privacy policy's "Service events"). `available` is false
 * on a server that records none, where there is nothing to switch.
 */
export interface ServiceAnalytics {
  available: boolean;
  enabled: boolean;
}

export const serviceAnalyticsQueryKey = [
  "user",
  "me",
  "service-analytics",
] as const;

const PATH = "/v1/user/me/service-analytics";

export function useServiceAnalytics() {
  return useQuery({
    queryKey: serviceAnalyticsQueryKey,
    queryFn: async () => (await api.get<ServiceAnalytics>(PATH)).data,
  });
}

export function useUpdateServiceAnalytics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.put<ServiceAnalytics>(PATH, { enabled })).data,
    scope: { id: "service-analytics" },
    onSuccess: (data) => {
      queryClient.setQueryData(serviceAnalyticsQueryKey, data);
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: serviceAnalyticsQueryKey,
        exact: true,
      }),
  });
}
