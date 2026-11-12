import { type AxiosInstance, isAxiosError } from "axios";

/**
 * Instance-wide bank sync health, read by an instance admin
 * (`GET /v1/admin/bank-sync/health` and `/failing`). Aggregates only: the API
 * returns no person, household, account or connection identifiers.
 */
export type BankConnectionStatus =
  "authorized" | "created" | "error" | "expired" | "linked";

export interface BankSyncInstitutionLabel {
  country: string | null;
  id: string;
  name: string | null;
}

export interface BankSyncErrorCodeCount {
  errorCode: string;
  incidents: number;
}

export interface BankSyncInstitutionHealth {
  attempts: number;
  failed: number;
  failingConnections: number;
  institution: BankSyncInstitutionLabel;
  needsAttention: boolean;
  partial: number;
  provider: string | null;
  succeeded: number;
  successRate: number | null;
}

export interface BankSyncHealth {
  connections: {
    byStatus: Record<BankConnectionStatus, number>;
    failing: number;
    total: number;
  };
  failingThresholdHours: number;
  generatedAt: string;
  incidentsByErrorCode: {
    last7Days: BankSyncErrorCodeCount[];
    last24Hours: BankSyncErrorCodeCount[];
  };
  institutions: BankSyncInstitutionHealth[];
  successRateWindowDays: number;
}

export interface FailingBankConnection {
  errorCode: string | null;
  failingSince: string;
  institution: BankSyncInstitutionLabel;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  provider: string;
  status: BankConnectionStatus;
}

export interface FailingBankConnections {
  connections: FailingBankConnection[];
  generatedAt: string;
  thresholdHours: number;
}

export interface AdminBankSync {
  failing: FailingBankConnections;
  health: BankSyncHealth;
}

/**
 * Both reads for the admin page, or `null` when the API answers 404: the
 * person is not an instance admin (the API never says 403 here, so the page's
 * existence is not revealed). Any other failure is thrown.
 */
export async function getAdminBankSync(
  api: AxiosInstance,
): Promise<AdminBankSync | null> {
  try {
    const [health, failing] = await Promise.all([
      api.get<BankSyncHealth>("/v1/admin/bank-sync/health"),
      api.get<FailingBankConnections>("/v1/admin/bank-sync/failing"),
    ]);
    return { failing: failing.data, health: health.data };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}
