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

// Fields common to both requisition shapes. `expiresAt` is the one
// deliberately shared field name: for legacy requisitions it's the
// requisition's own expiry, and for Enable Banking the API maps its real
// `access.valid_until` into this same key so callers can read `.expiresAt` uniformly without
// branching on `provider` first.
interface RequisitionBase {
  createdAt: string; // date
  updatedAt: string; // date
  deletedAt?: string | null;
  status: string;
  accounts: Account[];
  expiresAt?: string; // date
  provider: "GoCardless" | "EnableBanking";
}

export interface GoCardlessRequisition extends RequisitionBase {
  provider: "GoCardless";
  nordigenRequisitionKey: number;
  requisitionId: string;
  appuserKey: number;
  internalReference: string;
}

export interface EnableBankingInstitution {
  name: string;
  country: string;
  logoUrl: string | null;
}

export interface EnableBankingRequisition extends RequisitionBase {
  provider: "EnableBanking";
  enableBankingConnectionKey: number;
  state: string;
  aspspName: string;
  aspspCountry: string;
  status: "created" | "authorized" | "linked" | "error" | "expired";
  institution: EnableBankingInstitution;
}

export type Requisition = GoCardlessRequisition | EnableBankingRequisition;

export interface RequisitionsResponse {
  requisitions: Requisition[];
}

/**
 * Both provider variants have their own primary key column
 * (`nordigenRequisitionKey` / `enableBankingConnectionKey`) rather than a
 * unified one. This is the one place that needs to know both names.
 */
export function getRequisitionKey(requisition: Requisition): number {
  return requisition.provider === "GoCardless"
    ? requisition.nordigenRequisitionKey
    : requisition.enableBankingConnectionKey;
}

export async function getRequisitions(
  userId: string,
  apiClient: AxiosInstance = api,
): Promise<RequisitionsResponse> {
  const { data } = await apiClient.get<RequisitionsResponse>(
    `/v1/user/${userId}/requisitions`,
  );
  return data;
}

export default function useRequisitions<R = RequisitionsResponse>(
  userId?: string,
  options?: Omit<
    UseQueryOptions<RequisitionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["requisitions", userId],
    queryFn: userId ? () => getRequisitions(userId) : skipToken,
    ...options,
  });
}
