import {
  skipToken,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface UserDataResponse {
  emailAddress: string;
  firstName: string;
  lastName: string | null;
  twofactorEnabled: boolean;
}

async function getUserData(
  userId: string,
  apiClient: AxiosInstance = api,
): Promise<UserDataResponse> {
  const { data } = await apiClient.get<UserDataResponse>(`/v1/user/${userId}`);
  return data;
}

export default function useUserData<R = UserDataResponse>(
  userId?: string,
  options?: Omit<
    UseQueryOptions<UserDataResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["user", userId],
    queryFn: userId ? () => getUserData(userId) : skipToken,
    ...options,
  });
}
