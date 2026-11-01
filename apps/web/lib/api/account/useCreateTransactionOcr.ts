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

/**
 * Uploads a receipt to POST /v1/account/transaction/ocr as multipart/form-data
 * with the file in the `file` field (the API reads it with multer).
 *
 * The shared client defaults every request to `Content-Type:
 * application/json`, and axios serializes a FormData body to JSON under that
 * header, dropping the file. Declaring multipart here keeps the FormData
 * intact; the browser then fills in the boundary itself.
 */
export function uploadTransactionOcr(file: File, apiClient = api) {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.post<CreateTransactionOcrResponse>(
    "/v1/account/transaction/ocr",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
}

const useCreateTransactionOcr = () => {
  return useMutation({
    mutationFn: ({ file }: CreateTransactionOcrRequest) =>
      uploadTransactionOcr(file),
  });
};

export default useCreateTransactionOcr;
