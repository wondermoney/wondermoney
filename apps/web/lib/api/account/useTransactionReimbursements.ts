import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * A reimbursement link ties money in (a refund, a friend paying back their share) to the
 * expense it pays back, with an amount. The linked amount comes off the expense's category
 * spending and off income; account balances do not change. Links are many-to-many: one refund
 * may cover several expenses and one expense may have several refunds, and neither side's links
 * may add up to more than its amount. v1 links transactions in the same currency only.
 */

/** One side of a link, as the link and suggestion endpoints describe it. */
export interface LinkedTransaction {
  transactionKey: number;
  accountKey: number | null;
  accountName: string | null;
  description: string | null;
  merchantName: string | null;
  /** ISO. */
  transactionDate: string | null;
  /** Signed, effective (the user's edit wins), in `currencyCode`. */
  settlementAmount: number | null;
  currencyCode: string | null;
}

export interface ReimbursementLink {
  transactionReimbursementKey: number;
  /** Positive, in `currencyCode`. */
  amount: number;
  currencyCode: string;
  /** ISO. */
  createdAt: string;
  expense: LinkedTransaction;
  reimbursement: LinkedTransaction;
}

/** Out is an expense, in is a reimbursement; null for a zero amount. */
export type ReimbursementRole = "expense" | "reimbursement";

/** `GET .../reimbursements`: one transaction's links, in either role. */
export interface TransactionReimbursements {
  role: ReimbursementRole | null;
  /** The transaction's settlement currency. */
  currencyCode: string | null;
  /** The sum of its live links, positive. */
  linkedAmount: number;
  /** Its absolute amount minus `linkedAmount`, never below zero. */
  remainingAmount: number;
  links: ReimbursementLink[];
}

/** Why the API suggested a candidate: the same merchant, an amount that fits, or the search. */
export type ReimbursementSuggestionReason = "merchant" | "amount" | "search";

export interface ReimbursementSuggestion extends LinkedTransaction {
  /** What is still free to link on the candidate, positive. */
  remainingAmount: number;
  reason: ReimbursementSuggestionReason;
}

/** The API caps suggestions at 50 and sends 10 by default. */
export const REIMBURSEMENT_SUGGESTION_LIMIT = 20;

const reimbursementsKey = (transactionKey: number) => [
  "transaction-reimbursements",
  transactionKey,
];

const suggestionsKey = (transactionKey: number, search: string) => [
  "transaction-reimbursement-suggestions",
  transactionKey,
  search,
];

export async function getTransactionReimbursements(
  transactionKey: number,
  apiClient: AxiosInstance = api,
): Promise<TransactionReimbursements> {
  const { data } = await apiClient.get<TransactionReimbursements>(
    `/v1/account/transaction/${transactionKey}/reimbursements`,
  );
  return { ...data, links: Array.isArray(data?.links) ? data.links : [] };
}

/** A transaction's links, its role and how much of it is still free to link. */
export function useTransactionReimbursements(
  transactionKey: number,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: reimbursementsKey(transactionKey),
    queryFn: () => getTransactionReimbursements(transactionKey),
    enabled: options.enabled ?? true,
  });
}

export async function getReimbursementSuggestions(
  transactionKey: number,
  search: string,
  apiClient: AxiosInstance = api,
): Promise<ReimbursementSuggestion[]> {
  const { data } = await apiClient.get<{
    suggestions: ReimbursementSuggestion[];
  }>(`/v1/account/transaction/${transactionKey}/reimbursements/suggestions`, {
    params: {
      search: search || undefined,
      limit: REIMBURSEMENT_SUGGESTION_LIMIT,
    },
  });
  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

/**
 * Candidates for the other side of a link: for money in, the expenses it may pay back; for an
 * expense, the money in that may pay it back. Only the transaction's own currency, only
 * candidates with something left to link. `search` (already trimmed and debounced) drops the
 * merchant, amount and date window rules and matches the description or merchant instead.
 */
export function useReimbursementSuggestions(
  transactionKey: number,
  search: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: suggestionsKey(transactionKey, search),
    queryFn: () => getReimbursementSuggestions(transactionKey, search),
    enabled: options.enabled ?? true,
    // The previous list stays while the next search loads, rather than flashing empty.
    placeholderData: keepPreviousData,
  });
}

export interface LinkReimbursementRequest {
  /** The money in. */
  reimbursementTransactionKey: number;
  /** The money out. */
  expenseTransactionId: number;
  /** Positive, at most 4 decimals, in the expense's currency. */
  amount: number;
}

/**
 * Links money in to an expense. Errors: 404 `not_found`; 400 `reimbursement_currency_mismatch`,
 * `reimbursement_amount_exceeded`, `reimbursement_visibility_mismatch`, `reimbursement_invalid`;
 * 409 `reimbursement_link_exists`.
 */
export function useLinkReimbursement() {
  return useMutation({
    mutationFn: async ({
      reimbursementTransactionKey,
      expenseTransactionId,
      amount,
    }: LinkReimbursementRequest) => {
      const { data } = await api.post<{ link: ReimbursementLink }>(
        `/v1/account/transaction/${reimbursementTransactionKey}/reimbursements`,
        { expenseTransactionId, amount },
      );
      return data.link;
    },
  });
}

export interface UnlinkReimbursementRequest {
  /** Either side of the link. */
  transactionKey: number;
  transactionReimbursementKey: number;
}

/** Removes a link; the expense counts in full again and the money in counts as income. */
export function useUnlinkReimbursement() {
  return useMutation({
    mutationFn: async ({
      transactionKey,
      transactionReimbursementKey,
    }: UnlinkReimbursementRequest) => {
      const { data } = await api.delete<{
        transactionReimbursementKey: number;
      }>(
        `/v1/account/transaction/${transactionKey}/reimbursements/${transactionReimbursementKey}`,
      );
      return data;
    },
  });
}

/**
 * A link moves spending and income, not balances: after one changes, both transactions' links
 * and histories, every open suggestion list, the transaction lists (their badges), category
 * spending, cash flow, budgets and reports are stale.
 */
export const invalidateTransactionReimbursements = async (
  qc: QueryClient,
  transactionKeys: number[],
) => {
  await Promise.all([
    ...transactionKeys.flatMap((transactionKey) => [
      qc.invalidateQueries({ queryKey: reimbursementsKey(transactionKey) }),
      qc.invalidateQueries({
        queryKey: ["transaction-history", transactionKey],
      }),
    ]),
    qc.invalidateQueries({
      queryKey: ["transaction-reimbursement-suggestions"],
    }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions-infinite"] }),
    qc.invalidateQueries({ queryKey: ["account-transactions"] }),
    qc.invalidateQueries({ queryKey: ["transactions-category-spending"] }),
    qc.invalidateQueries({ queryKey: ["accounts-cashflow"] }),
    qc.invalidateQueries({ queryKey: ["accounts-metrics"] }),
    qc.invalidateQueries({ queryKey: ["account-metrics"] }),
    qc.invalidateQueries({ queryKey: ["reports"] }),
    qc.invalidateQueries({ queryKey: ["budgets"] }),
    qc.invalidateQueries({ queryKey: ["budget"] }),
    qc.invalidateQueries({ queryKey: ["budgets-full"] }),
  ]);
};
