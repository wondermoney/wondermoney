import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type { Category } from "../category/useCategories";

export interface Transaction {
  transactionKey: number;
  transactionDate: string; // date iso
  recurringSeries?: {
    recurringSeriesKey: number;
    displayName: string;
    type: "subscription" | "bill";
    amountType: "fixed" | "variable";
    status: "candidate" | "confirmed" | "dismissed" | "paused" | "ended";
  } | null;
  transactionTypeKey?: { name: string };
  accountKey: {
    accountName: string;
    accountKey: number;
    accountFinancialInstitutionKey?: { logoUrl?: string }; // fake transactions dont have this
    currencyKey: { code: SupportedCurrencyCodes }; // fake transactions do have this
  };
  notes?: string;
  settlementAmount: number;
  editedSettlementAmount?: number;
  settlementCurrencyKey: { code: SupportedCurrencyCodes };
  appuserSettlementAmount: number;
  appuserCurrencyKey: { code: SupportedCurrencyCodes };
  balance: number;
  appuserCurrencyBalance: number;
  appuserTransactionCategories: Category[];
  loanRepayment?: {
    loanKey: number;
    loanKeys?: number[];
    loanName: string;
    principalAmount: number;
    interestAmount: number;
    feeAmount: number;
    spendingAmount: number;
  };
  transactionMerchantKey?: { name: string };
  description: string;
  descriptionDirty: string;
  reviewed: boolean;
  hidden: boolean;
  categorizationConfidence?: "high" | "medium" | "low" | "none" | null;
  categorizationReason?: string | null;
}

export enum TransactionType {
  CREDIT = "credit",
  DEBIT = "debit",
}

export interface GetTransactionsResponse {
  transactions: Transaction[];
  /**
   * Rows matching the filters, before `limit` — so the table can say
   * "12 of 8,623" rather than only what it happens to be holding.
   *
   * Optional because a client can be newer than the API it is talking to
   * (preview against staging, a rolled-back deploy); readers must fall back to
   * the loaded row count rather than rendering `undefined`.
   *
   * `null` on a continuation page: the API only counts on the first page,
   * because repeating the count for every page of a long scroll is pure waste.
   */
  total?: null | number;
  limit?: number;
  hasMore?: boolean;
  /**
   * Opaque continuation token — pass back as `cursor` for the next page, or
   * `null` when this is the last one.
   *
   * Optional for the same reason as `total`: an older API does not send it, and
   * {@link useInfiniteTransactions} then simply stops after one page, which is
   * exactly the behaviour every caller had before the cursor existed.
   */
  nextCursor?: null | string;
}

/** The client's sentinel for "transactions with no category at all". Matches the API's value. */
export const UNCATEGORIZED_FILTER_VALUE = "__uncategorized__";

export interface GetTransactionRequest {
  unreviewedOnly?: boolean;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  includeEmptyAccounts?: boolean;
  includeHidden?: boolean;
  /**
   * RAD-579 — filters that used to run in the browser over the loaded page only, so filtering a
   * year by one category filtered whichever rows happened to come back. Sent to the endpoint now.
   *
   * Serialised comma-separated; `categoryKeys` may include {@link UNCATEGORIZED_FILTER_VALUE},
   * which the API unions with the named keys rather than treating as a key.
   */
  accountKeys?: string[];
  transactionTypes?: string[];
  categoryKeys?: string[];
  /**
   * Continuation token from the previous page's `nextCursor`. Omit for page one.
   *
   * Keyset, not offset: the cursor names the last row seen, so inserts and
   * deletes between pages cannot duplicate or skip a row the way `offset` does.
   * Callers should not construct or parse this — it is the API's to define.
   */
  cursor?: string;
}

/**
 * Fetches transactions from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Query parameters for filtering transactions
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getTransactions(
  params: GetTransactionRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetTransactionsResponse> {
  // RAD-579 — an empty array means "no filter", not "match nothing", so it is dropped rather than
  // sent as an empty value the API would have to guess at.
  const list = (values?: string[]) =>
    values && values.length > 0 ? values.join(",") : undefined;

  const _params = {
    ...params,
    ...(params.fromDate && { fromDate: params.fromDate.getTime() }),
    ...(params.toDate && { toDate: params.toDate.getTime() }),
    accountKeys: list(params.accountKeys),
    categoryKeys: list(params.categoryKeys),
    transactionTypes: list(params.transactionTypes),
  };
  const { data } = await apiClient.get<GetTransactionsResponse>(
    "/v1/account/transaction",
    { params: _params },
  );
  return data;
}

/**
 * The transaction list, following the API's cursor to the end.
 *
 * ## Why this exists
 *
 * The endpoint caps a page at `limit` (default 100) and always has. The single-page
 * {@link useTransactions} renders that page and the footer reports `total` from the
 * server — so a 8,623-row range showed "100 of 8,623" with **no way to reach row
 * 101**. The rows were not missing from the response by accident; there was simply
 * no second request. `hasMore: true` came back on every such page and nothing read
 * it.
 *
 * Pages are flattened into one `transactions` array because every consumer wants the
 * list, not the pagination mechanics. `total` is taken from the **first** page only:
 * the API stops counting on continuation pages, and a later `undefined` must not
 * blank out a count the footer is already showing.
 */
export function useInfiniteTransactions(
  params: GetTransactionRequest = {},
  options?: { enabled?: boolean; initialData?: GetTransactionsResponse },
) {
  const query = useInfiniteQuery({
    queryKey: ["accounts-transactions-infinite", params],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      getTransactions({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    // `?? undefined` and not `?? null`: react-query stops paging on a nullish
    // cursor, and an older API omits the field entirely — both mean "no more".
    getNextPageParam: (lastPage: GetTransactionsResponse) =>
      lastPage.nextCursor ?? undefined,
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
    initialData: options?.initialData
      ? { pageParams: [undefined], pages: [options.initialData] }
      : undefined,
  });

  const pages = query.data?.pages;
  const firstPage = pages?.[0];

  return {
    ...query,
    data: pages
      ? {
          hasMore: query.hasNextPage,
          limit: firstPage?.limit,
          total: firstPage?.total ?? undefined,
          transactions: pages.flatMap((page) => page.transactions),
        }
      : undefined,
  };
}

export default function useTransactions<R = GetTransactionsResponse>(
  params?: GetTransactionRequest,
  options?: Omit<
    UseQueryOptions<GetTransactionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["accounts-transactions", params],
    queryFn: () => getTransactions(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
