import { useMutation } from "@tanstack/react-query";

import api from "../api";
import { CreateTransactionRequest } from "./useCreateTransaction";

export interface RejectTransactionOcrRequest {
  transactionOcrImportId: number;
}

export interface ConfirmTransactionOcrResponse {}

const useRejectTransactionOcr = () => {
  return useMutation({
    mutationFn: ({ transactionOcrImportId }: RejectTransactionOcrRequest) =>
      api.put<ConfirmTransactionOcrResponse>(
        `/v1/account/transaction/ocr/${transactionOcrImportId}/reject`,
      ),
  });
};

export default useRejectTransactionOcr;
