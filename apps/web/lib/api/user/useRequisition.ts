import {
  skipToken,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface Account {
  accountKey: number;
  createdAt: string; // date
  updatedAt: string; // date
  deletedAt: string | null;
  tenantKey: number;
  accountOwnerAppuserKey: number;
  accountExclusion?: any;
  accountNumber: string;
  balance: string;
  closed: boolean;
  currencyDenominatedBalance: number | null;
  excluded: boolean;
  favored: boolean;
  flags?: any;
  holderName: string;
  accountId: string;
  identifiers?: any;
  ownership?: any;
  accountName: string;
  refreshedAt: string; // date
  accountFinancialInstitutionKey: number;
  accountTypeKey: number | null;
  accountCredentialsKey: number | null;
  currencyKey: number;
  nordigenRequisitionKey: number;
}

export interface Requisition {
  nordigenRequisitionKey: number;
  createdAt: string; // date
  updatedAt: string; // date
  deletedAt?: string | null;
  requisitionId: string;
  status: string;
  appuserKey: number;
  expiresAt?: string; // date
  internalReference: string;
  accounts: Account[];
  provider: string;
}

export interface RequisitionResponse {
  requisition: Requisition;
}

export async function getRequisition(
  userId: string,
  requisitionId: string,
  apiClient: AxiosInstance = api,
): Promise<RequisitionResponse> {
  const { data } = await apiClient.get<RequisitionResponse>(
    `/v1/user/${userId}/requisition/${requisitionId}`,
  );
  return data;
}

export default function useRequisition<R = RequisitionResponse>(
  userId?: string,
  requisitionId?: string | null,
  options?: Omit<
    UseQueryOptions<RequisitionResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["requisition", userId, requisitionId],
    queryFn:
      userId && requisitionId
        ? () => getRequisition(userId, requisitionId)
        : skipToken,
    ...options,
  });
}
