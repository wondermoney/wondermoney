import { useMutation } from "@tanstack/react-query";

import api from "../api";
import { CreateTransactionRequest } from "./useCreateTransaction";

type OcrConfirmationAmount = number | string;

export interface ConfirmTransactionOcrRequest
  extends Omit<
    CreateTransactionRequest,
    "exchangeRate" | "originalAmount" | "settlementAmount"
  > {
  exchangeRate?: OcrConfirmationAmount;
  originalAmount?: OcrConfirmationAmount;
  settlementAmount: OcrConfirmationAmount;
  transactionOcrImportId: number;
}

export interface ConfirmTransactionOcrResponse {}

type ConfirmTransactionOcrPayload = Omit<
  ConfirmTransactionOcrRequest,
  "transactionOcrImportId"
>;

const stringifyAmount = (value: OcrConfirmationAmount | undefined) =>
  value === undefined ? undefined : String(value);

/**
 * The body of PUT /v1/account/transaction/ocr/:id/confirm. Amounts go as
 * strings (the API validates them as strings) and the category as the
 * one-element `categoryIds` list the endpoint reads.
 */
export const buildConfirmTransactionOcrPayload = ({
  accountId,
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
}: ConfirmTransactionOcrPayload) => ({
  accountId,
  categoryIds: categoryId ? [categoryId] : undefined,
  description,
  exchangeRate: stringifyAmount(exchangeRate),
  notes,
  originalAmount: stringifyAmount(originalAmount),
  originalCurrencyId,
  settlementAmount: stringifyAmount(settlementAmount),
  settlementCurrencyId,
  transactionDate,
  transactionMerchantId,
  transactionMerchantName,
  transactionTypeId,
});

const useConfirmTransactionOcr = () => {
  return useMutation({
    mutationFn: ({
      transactionOcrImportId,
      ...request
    }: ConfirmTransactionOcrRequest) =>
      api.put<ConfirmTransactionOcrResponse>(
        `/v1/account/transaction/ocr/${transactionOcrImportId}/confirm`,
        buildConfirmTransactionOcrPayload(request),
      ),
  });
};

export default useConfirmTransactionOcr;
