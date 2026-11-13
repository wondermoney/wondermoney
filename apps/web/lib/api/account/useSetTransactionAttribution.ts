import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { TransactionAttribution } from "./useTransactions";

/**
 * Whose spending a transaction counts as: a member's appuser key, `"shared"` for the household as
 * a whole, or `null` to follow its account again.
 */
export type AttributedAppuserKey = number | "shared" | null;

export interface SetTransactionAttributionRequest {
  transactionKey: number;
  attributedAppuserKey: AttributedAppuserKey;
}

export interface SetTransactionAttributionResponse {
  transaction: { transactionKey: number; attribution: TransactionAttribution };
}

/**
 * `PATCH /v1/account/transaction/:transactionId` with `attributedAppuserKey`. A key that is not a
 * household member answers 400; a viewer's write answers `household_read_only`.
 */
export async function setTransactionAttribution(
  { transactionKey, attributedAppuserKey }: SetTransactionAttributionRequest,
  apiClient: AxiosInstance = api,
): Promise<SetTransactionAttributionResponse> {
  const { data } = await apiClient.patch<SetTransactionAttributionResponse>(
    `/v1/account/transaction/${transactionKey}`,
    { attributedAppuserKey },
  );
  return data;
}

/**
 * "Spent by" moves money between members, not between accounts: the transaction lists (their
 * badges and the member filter), the dashboard's cash flow and category spending, reports and
 * budgets are stale. Balances and net worth are not.
 */
export const invalidateAfterAttributionChange = async (qc: QueryClient) => {
  await Promise.all(
    [
      ["transactions"],
      ["accounts-transactions"],
      ["accounts-transactions-infinite"],
      ["account-transactions"],
      ["transaction-history"],
      ["accounts-cashflow"],
      ["transactions-category-spending"],
      ["reports"],
      ["budgets"],
      ["budgets-full"],
      ["budget"],
      ["budget-template-year-month"],
      ["budgets-transactions"],
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
};

export default function useSetTransactionAttribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: SetTransactionAttributionRequest) =>
      setTransactionAttribution(request),
    onSuccess: () => invalidateAfterAttributionChange(qc),
  });
}
