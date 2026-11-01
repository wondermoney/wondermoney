import { skipToken, useQuery, UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface Onboarding {
  step: number;
  description: string;
  done: boolean;
}

export interface OnboardingResponse {
  onboarding: Onboarding[];
}

async function getOnboarding(
  userId: string,
  apiClient: AxiosInstance = api,
): Promise<OnboardingResponse> {
  const { data } = await apiClient.get<OnboardingResponse>(
    `/v1/user/${userId}/onboarding`,
  );
  return data;
}

export default function useOnboarding<R = OnboardingResponse>(
  userId?: string,
  options?: Omit<
    UseQueryOptions<OnboardingResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["onboarding", userId],
    queryFn: userId ? () => getOnboarding(userId) : skipToken,
    ...options,
  });
}
