import { useQuery } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * The review inbox's status, as the home shows it: how many transactions are
 * waiting for review and what their amounts add up to in the reader's own
 * currency.
 *
 * `count` is the list's `total` for `unreviewedOnly=true` — the API computes both
 * from one query, so the two cannot drift. Read `totalAbs` through
 * `useFormatCurrency()` so privacy mode masks it like every other figure.
 */
export interface TransactionReviewSummary {
  count: number;
  /** The sum of the absolute amounts awaiting review, in `currency`. */
  totalAbs: number;
  /** The reader's base currency code. */
  currency: string;
}

export async function getTransactionReviewSummary(
  apiClient: AxiosInstance = api,
): Promise<TransactionReviewSummary> {
  const { data } = await apiClient.get<TransactionReviewSummary>(
    "/v1/account/transaction/review-summary",
  );
  return data;
}

export default function useTransactionReviewSummary() {
  return useQuery({
    queryKey: ["account-transaction-review-summary"],
    queryFn: () => getTransactionReviewSummary(),
  });
}
