import { useMutation } from "@tanstack/react-query";

import api from "../api";
import { CreateTransactionRequest } from "./useCreateTransaction";

type OcrConfirmationAmount = number | string;

export interface ConfirmTransactionOcrRequest
  extends Omit<
    CreateTransactionRequest,
    "categoryId" | "exchangeRate" | "originalAmount" | "settlementAmount"
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

export const buildConfirmTransactionOcrPayload = ({
  accountId,
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
