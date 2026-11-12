import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";

export type CreditCardStatementStatus = "closed" | "open" | "overdue" | "paid";

export interface CreditCardStatement {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  charges: number;
  payments: number;
  balance: number;
  availableCredit: number | null;
  isCurrent: boolean;
  status: CreditCardStatementStatus;
}

export interface CreditCardStatementTransaction {
  amount: number | null;
  description: string | null;
  merchantName: string | null;
  /** The calendar day the row is counted in, `YYYY-MM-DD`. */
  transactionDate: string | null;
  transactionKey: number;
}

export interface CreditCardStatementDetail extends CreditCardStatement {
  transactions: CreditCardStatementTransaction[];
}

export interface GetCreditCardStatementsResponse {
  statements: CreditCardStatement[];
}

export interface GetCreditCardStatementDetailResponse {
  statement: CreditCardStatementDetail;
}

export interface CreditCardStatementsParams {
  accountKey: number | string;
  from?: string;
  to?: string;
}

function isStatementStatus(value: unknown): value is CreditCardStatementStatus {
  return (
    value === "closed" ||
    value === "open" ||
    value === "overdue" ||
    value === "paid"
  );
}

function isStatement(value: unknown): value is CreditCardStatement {
  if (typeof value !== "object" || value === null) return false;
  const statement = value as Record<string, unknown>;
  return (
    typeof statement.periodStart === "string" &&
    typeof statement.periodEnd === "string" &&
    typeof statement.dueDate === "string" &&
    typeof statement.charges === "number" &&
    typeof statement.payments === "number" &&
    typeof statement.balance === "number" &&
    (statement.availableCredit === null ||
      typeof statement.availableCredit === "number") &&
    typeof statement.isCurrent === "boolean" &&
    isStatementStatus(statement.status)
  );
}

function isStatementTransaction(
  value: unknown,
): value is CreditCardStatementTransaction {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.transactionKey === "number" &&
    (row.amount === null || typeof row.amount === "number") &&
    (row.description === null || typeof row.description === "string") &&
    (row.merchantName === null || typeof row.merchantName === "string") &&
    (row.transactionDate === null || typeof row.transactionDate === "string")
  );
}

async function getCreditCardStatements({
  accountKey,
  from,
  to,
}: CreditCardStatementsParams): Promise<GetCreditCardStatementsResponse> {
  const { data } = await api.get<unknown>(
    `/v1/account/${accountKey}/statements`,
    { params: { ...(from ? { from } : {}), ...(to ? { to } : {}) } },
  );
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { statements?: unknown }).statements)
  ) {
    throw new Error("Invalid statements response");
  }
  const statements = (data as { statements: unknown[] }).statements;
  if (!statements.every(isStatement)) {
    throw new Error("Invalid statements response");
  }
  return { statements };
}

/** The card's statements for a window (default: the API's last three months). */
export default function useCreditCardStatements<R = GetCreditCardStatementsResponse>(
  params: CreditCardStatementsParams,
  options?: Omit<
    UseQueryOptions<GetCreditCardStatementsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["credit-card-statements", params.accountKey, params.from, params.to],
    queryFn: () => getCreditCardStatements(params),
    ...options,
  });
}

async function getCreditCardStatementDetail({
  accountKey,
  statementDate,
}: {
  accountKey: number | string;
  statementDate: string;
}): Promise<GetCreditCardStatementDetailResponse> {
  const { data } = await api.get<unknown>(
    `/v1/account/${accountKey}/statements/${statementDate}`,
  );
  const statement =
    typeof data === "object" && data !== null
      ? (data as { statement?: unknown }).statement
      : undefined;
  if (!isStatement(statement)) throw new Error("Invalid statement response");
  const transactions = (statement as { transactions?: unknown }).transactions;
  if (!Array.isArray(transactions) || !transactions.every(isStatementTransaction)) {
    throw new Error("Invalid statement response");
  }
  return { statement: statement as CreditCardStatementDetail };
}

/**
 * One statement and the transactions it counts, named by its close day. Disabled until a statement
 * is selected, so opening the tab costs one request, not one per statement.
 */
export function useCreditCardStatementDetail(
  params: { accountKey: number | string; statementDate: string | null },
  options?: Omit<
    UseQueryOptions<GetCreditCardStatementDetailResponse, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    // Under the card's statements key, so invalidating the card's statements refreshes it too.
    queryKey: [
      "credit-card-statements",
      params.accountKey,
      "detail",
      params.statementDate,
    ],
    queryFn: () => {
      const statementDate = params.statementDate;
      if (!statementDate) throw new Error("A statement date is required");
      return getCreditCardStatementDetail({
        accountKey: params.accountKey,
        statementDate,
      });
    },
    enabled: Boolean(params.statementDate),
    ...options,
  });
}
