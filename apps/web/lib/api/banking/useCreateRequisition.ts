import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface GetCreateRequisitionResponse {
  redirectUrl: string;
}

export async function getCreateRequisition(
  bankId: string,
  page?: string,
  apiClient: AxiosInstance = api,
): Promise<GetCreateRequisitionResponse> {
  const queryParams = page
    ? `?${new URLSearchParams({ redirectPage: page }).toString()}`
    : "";
  const { data } = await apiClient.get<GetCreateRequisitionResponse>(
    `/v1/banking/bank/${bankId}/start${queryParams}`,
  );
  return data;
}

export default function useCreateRequisition<R = GetCreateRequisitionResponse>(
  bankId: string,
  page?: string,
  options?: Omit<
    UseQueryOptions<GetCreateRequisitionResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["createRequisition", bankId, page],
    queryFn: () => getCreateRequisition(bankId, page),
    ...options,
  });
}
