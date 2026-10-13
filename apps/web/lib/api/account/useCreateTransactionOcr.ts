import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CreateTransactionOcrRequest {
  file: File;
}

export interface TransactionOCRInfo {
  transactionDate?: Date;
  settlementAmount?: string;
  settlementCurrencyId?: number;
  transactionMerchantId?: number;
  transactionMerchantName?: string;
}

export interface CreateTransactionOcrResponse {
  transactionOcrImportId: number;
  transactionInfo: TransactionOCRInfo;
}

export const OCR_UPLOAD_MAX_BYTES = 5_000_000;

const useCreateTransactionOcr = () => {
  return useMutation({
    mutationFn: ({ file }: CreateTransactionOcrRequest) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post<CreateTransactionOcrResponse>(
        "/v1/account/transaction/ocr",
        formData,
      );
    },
  });
};

export default useCreateTransactionOcr;
