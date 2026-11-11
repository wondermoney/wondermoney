import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";

export interface CreditCardStatement {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  charges: number;
  payments: number;
  balance: number;
  availableCredit: number | null;
  isCurrent: boolean;
}

export interface GetCreditCardStatementsResponse {
  statements: CreditCardStatement[];
}

export interface CreditCardStatementsParams {
  accountKey: number | string;
  from?: string;
  to?: string;
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
    typeof statement.isCurrent === "boolean"
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
