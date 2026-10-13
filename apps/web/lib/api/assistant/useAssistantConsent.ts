import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AssistantConsent } from "./types";

export interface AssistantConsentResponse {
  consent: AssistantConsent;
}

export async function getAssistantConsent(
  apiClient: AxiosInstance = api,
): Promise<AssistantConsent> {
  const { data } = await apiClient.get<AssistantConsentResponse>(
    "/v1/assistant/consent",
  );
  return data.consent;
}

export default function useAssistantConsent<R = AssistantConsent>(
  options?: Omit<UseQueryOptions<AssistantConsent, Error, R>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["assistant", "consent"],
    queryFn: () => getAssistantConsent(),
    ...options,
  });
}
