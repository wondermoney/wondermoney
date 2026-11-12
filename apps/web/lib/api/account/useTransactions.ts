import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { TransferDestinationRow } from "@/lib/account/transaction-transfer";
import type { FxFields } from "@/lib/fx/fx-status";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type { Category } from "../category/useCategories";
import type { AmountsCompleteness } from "../completeness";
import { transactionDateRangeParams } from "../date-range";
import type { TransactionInstallment } from "../installment-plans/types";
import type { Tag } from "../tag/useTags";
import type { TransactionMerchant } from "./useTransactionMerchants";
import type { ReimbursementLink } from "./useTransactionReimbursements";
import type { TransactionSplitLine } from "./useTransactionSplits";

/**
 * `fxStatus` / `fxRateDate` say how `appuserSettlementAmount` was converted
 * (`lib/fx/fx-status.ts`); read them through `transactionFxView`.
 */
export interface Transaction extends FxFields {
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
  /**
   * Where an outgoing transfer went, when the user said so. Optional because
   * an older API does not send it.
   */
  transferDestination?: TransferDestinationRow | null;
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
  /** Null when no exchange rate converts the amount (`fxStatus` `missing`). */
  appuserSettlementAmount: number | null;
  appuserCurrencyKey: { code: SupportedCurrencyCodes };
  balance: number;
  appuserCurrencyBalance: number;
  appuserTransactionCategories: Category[];
  /**
   * The household tags on the row, by name. Optional because an older API does
   * not send it; read it as `transaction.tags ?? []`.
   */
  tags?: Tag[];
  /**
   * The lines of a split transaction, in order; empty when it is not split. Optional because an
   * older API does not send it; read it through `isSplitTransaction`.
   */
  splits?: TransactionSplitLine[];
  /**
   * Its reimbursement links, in either role (an expense paid back, or money in paying one back),
   * only those whose other side the viewer can see; empty when none. Optional because an older
   * API does not send it; read it as `transaction.reimbursements ?? []`.
   */
  reimbursements?: ReimbursementLink[];
  loanRepayment?: {
    loanKey: number;
    loanKeys?: number[];
    loanName: string;
    principalAmount: number;
    interestAmount: number;
    feeAmount: number;
    spendingAmount: number;
  };
  /**
   * The installment of a plan this row is (shown as "3/12"), or null. Optional because an
   * older API does not send it.
   */
  installment?: TransactionInstallment | null;
  /** The row's merchant; absent when it has none. */
  transactionMerchantKey?: TransactionMerchant;
  description: string;
  descriptionDirty: string;
  /** How many live attachments the row has; absent on an older API, read as zero. */
  attachmentCount?: number;
  reviewed: boolean;
  hidden: boolean;
  /**
   * The bank sent this row, so it cannot be deleted (only hidden). Optional because an older API
   * does not send it; read it as `transaction.bankSynced === true`.
   */
  bankSynced?: boolean;
  categorizationConfidence?: "high" | "medium" | "low" | "none" | null;
  categorizationReason?: string | null;
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
  /**
   * What the matching rows add up to in the viewer's currency, from the same
   * query as `total`; with `excludeNonSpending` or a category filter, only the
   * split lines those keep. `null` on a continuation page, absent from an older
   * API. Rows with no exchange rate are left out and counted in `completeness`.
   */
  totalAmount?: null | number;
  /**
   * The parts of `totalAmount` from rows that add money and from rows that
   * take it (as a positive amount), from the same query. `null` on a
   * continuation page, absent from an older API.
   */
  moneyIn?: null | number;
  moneyOut?: null | number;
  completeness?: AmountsCompleteness | null;
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
const UNCATEGORIZED_FILTER_VALUE = "__uncategorized__";

export interface GetTransactionRequest {
  unreviewedOnly?: boolean;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  includeEmptyAccounts?: boolean;
  includeHidden?: boolean;
  /**
   * Filters applied by the endpoint, not in the browser over the loaded page (which would filter
   * only whichever rows happened to come back).
   *
   * Serialised comma-separated; `categoryKeys` may include {@link UNCATEGORIZED_FILTER_VALUE},
   * which the API unions with the named keys rather than treating as a key.
   */
  accountKeys?: string[];
  transactionTypes?: string[];
  categoryKeys?: string[];
  /** Tag keys; a row matches when it carries any of them. */
  tagKeys?: string[];
  /**
   * A report's scope (`lib/account/transaction-report-scope.ts`), so the list
   * holds exactly the rows behind a report total. Absent, the list shows every
   * status but expired, transfers and every category.
   */
  statuses?: string[];
  excludeTransfers?: boolean;
  excludeNonSpending?: boolean;
  direction?: "in" | "out";
  merchantKeys?: string[];
  memberCurrency?: string;
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
/** The filters of a transaction list request, without its paging. */
export type TransactionListFilter = Omit<
  GetTransactionRequest,
  "cursor" | "limit" | "includeEmptyAccounts"
>;

/**
 * The list's query parameters, as the API reads them. An empty array means "no filter", not
 * "match nothing", so it is dropped rather than sent as an empty value the API would have to
 * guess at.
 */
export function transactionListParams(params: GetTransactionRequest) {
  const list = (values?: string[]) =>
    values && values.length > 0 ? values.join(",") : undefined;

  return {
    ...params,
    ...transactionDateRangeParams(params),
    accountKeys: list(params.accountKeys),
    categoryKeys: list(params.categoryKeys),
    tagKeys: list(params.tagKeys),
    transactionTypes: list(params.transactionTypes),
    statuses: list(params.statuses),
    merchantKeys: list(params.merchantKeys),
  };
}

/**
 * The `filter` a bulk change or delete takes for "every row this list matches": the same
 * parameters as the list, without paging, and without keys that are unset (the API refuses a key
 * it does not know, and would read an explicit `undefined` as no key anyway).
 */
export function transactionSelectionFilter(
  filter: TransactionListFilter,
): Record<string, string | boolean> {
  const paging = new Set(["cursor", "limit", "includeEmptyAccounts"]);
  return Object.fromEntries(
    Object.entries(transactionListParams(filter)).filter(
      (entry): entry is [string, string | boolean] =>
        !paging.has(entry[0]) &&
        (typeof entry[1] === "string" || typeof entry[1] === "boolean"),
    ),
  );
}

export async function getTransactions(
  params: GetTransactionRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetTransactionsResponse> {
  const { data } = await apiClient.get<GetTransactionsResponse>(
    "/v1/account/transaction",
    { params: transactionListParams(params) },
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
  options?: {
    enabled?: boolean;
    initialData?: GetTransactionsResponse;
    initialDataUpdatedAt?: () => number;
  },
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
    initialDataUpdatedAt: options?.initialDataUpdatedAt,
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
          totalAmount: firstPage?.totalAmount ?? undefined,
          completeness: firstPage?.completeness ?? undefined,
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
