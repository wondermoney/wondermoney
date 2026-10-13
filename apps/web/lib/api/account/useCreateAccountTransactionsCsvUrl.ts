import { useMutation } from "@tanstack/react-query";

import api from "../api";

interface CreateAccountTransactionsUploadCsvPresignedUrlRequest {
  accountId: string | number;
}

export interface CreateAccountTransactionsUploadCsvPresignedUrlResponse {
  key: string;
  presignedUrl: string;
  isSupportedBank: boolean;
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
