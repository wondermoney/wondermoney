import { useMutation } from "@tanstack/react-query";

import api from "../api";
import type { AccountCsvImportFormat } from "./useAccounts";

interface CreateAccountTransactionsUploadCsvPresignedUrlRequest {
  accountId: string | number;
}

export interface CreateAccountTransactionsUploadCsvPresignedUrlResponse {
  key: string;
  presignedUrl: string;
  isSupportedBank: boolean;
  /** Which file the import reads; every account can import, in one format or the other. */
  csvImportFormat?: AccountCsvImportFormat;
}

const useCreateAccountTransactionsCsvUrl = () => {
  return useMutation({
    mutationFn: ({
      accountId,
    }: CreateAccountTransactionsUploadCsvPresignedUrlRequest) =>
      api.post<CreateAccountTransactionsUploadCsvPresignedUrlResponse>(
        `/v1/account/${accountId}/transaction/upload`,
      ),
  });
};

export default useCreateAccountTransactionsCsvUrl;
