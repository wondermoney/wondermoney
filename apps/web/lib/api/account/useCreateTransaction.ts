import { useMutation } from "@tanstack/react-query";

import api from "../api";

type TransactionAmount = number | string;

export interface CreateTransactionRequest {
  transactionDate: Date;
  transactionTypeId: string;
  accountId: string;
  description?: string;
  notes?: string;
  originalAmount?: TransactionAmount;
  originalCurrencyId?: string;
  exchangeRate?: TransactionAmount;
  settlementAmount: TransactionAmount;
  settlementCurrencyId: string;
  transactionMerchantId?: number;
  transactionMerchantName: string;
  categoryId?: string;
}

const stringifyAmount = (value: TransactionAmount | undefined) =>
  value === undefined ? undefined : String(value);

/**
 * The body of POST /v1/account/:accountId/transaction. The API validates
 * `originalAmount` and `exchangeRate` as strings (a JSON number is a 400), so
 * every amount is sent as a string; the original-currency fields are sent only
 * together with an original amount.
 */
export const buildCreateTransactionPayload = ({
  categoryId,
  description,
  exchangeRate,
  notes,
  originalAmount,
  originalCurrencyId,
  settlementAmount,
  settlementCurrencyId,
  transactionDate,
  transactionMerchantId,
  transactionMerchantName,
  transactionTypeId,
}: Omit<CreateTransactionRequest, "accountId">) => {
  const hasOriginalAmount = originalAmount !== undefined;

  return {
    categoryId,
    description,
    exchangeRate: hasOriginalAmount ? stringifyAmount(exchangeRate) : undefined,
    notes,
    originalAmount: stringifyAmount(originalAmount),
    originalCurrencyId: hasOriginalAmount ? originalCurrencyId : undefined,
    settlementAmount: stringifyAmount(settlementAmount),
    settlementCurrencyId,
    transactionDate,
    transactionMerchantId,
    transactionMerchantName,
    transactionTypeId,
  };
};

const useCreateTransaction = () => {
  return useMutation({
    mutationFn: ({ accountId, ...request }: CreateTransactionRequest) =>
      api.post(
        `/v1/account/${accountId}/transaction`,
        buildCreateTransactionPayload(request),
      ),
  });
};

export default useCreateTransaction;
