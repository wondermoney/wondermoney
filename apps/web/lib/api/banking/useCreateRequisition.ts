import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface GetCreateRequisitionResponse {
  redirectUrl: string;
}

export async function getCreateRequisition(
  bankId: string,
  apiClient: AxiosInstance = api,
): Promise<GetCreateRequisitionResponse> {
  const { data } = await apiClient.get<GetCreateRequisitionResponse>(
    `/v1/banking/bank/${bankId}/start`,
  );
  return data;
}

export default function useCreateRequisition<R = GetCreateRequisitionResponse>(
  bankId: string,
  options?: Omit<
    UseQueryOptions<GetCreateRequisitionResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["createRequisition", bankId],
    queryFn: () => getCreateRequisition(bankId),
    ...options,
  });
}
