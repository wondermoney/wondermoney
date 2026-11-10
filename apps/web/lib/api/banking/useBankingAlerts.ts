import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "@/lib/api/api";

/**
 * `GET /v1/banking/alerts`: the viewer's own bank connections that need
 * attention. `consent_expiring`: the consent ends within 7 days.
 * `consent_revoked`: the bank ended it early. `sync_failing`: scheduled syncs
 * have failed for 48h or more with non-transient errors.
 */
export type BankingAlertKind =
  | "consent_expiring"
  | "consent_revoked"
  | "sync_failing";

export interface BankingAlert {
  /** Opaque and stable per alert episode; a new stage gets a new id. */
  id: string;
  kind: BankingAlertKind;
  institutionName: string | null;
  bankId: string | null;
  /** Consent end (ISO), set for `consent_expiring`. */
  expiresAt: string | null;
  /** Whole days left (0..7), set for `consent_expiring`. */
  daysUntilExpiry: number | null;
  /** First failure of the streak (ISO), set for `sync_failing`. */
  failingSince: string | null;
}

export interface BankingAlertsResponse {
  alerts: BankingAlert[];
}

export async function getBankingAlerts(
  apiClient: Pick<AxiosInstance, "get"> = api,
): Promise<BankingAlertsResponse> {
  const { data } = await apiClient.get<BankingAlertsResponse>(
    "/v1/banking/alerts",
  );
  return data;
}

export default function useBankingAlerts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["banking", "alerts"],
    queryFn: () => getBankingAlerts(),
    enabled: options?.enabled ?? true,
  });
}
