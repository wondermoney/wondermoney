import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface StartAccountCsvImportRequest {
  accountId: string | number;
  key: string;
}

export interface StartAccountCsvImportResponse {
  correlationId: string;
  status: string;
}

export const buildStartAccountCsvImportUrl = (accountId: string | number) =>
  `/v1/account/${accountId}/transaction/import`;

export const buildStartAccountCsvImportPayload = (key: string) => ({ key });

const useStartAccountCsvImport = () => {
  return useMutation({
    mutationFn: ({ accountId, key }: StartAccountCsvImportRequest) =>
      api.post<StartAccountCsvImportResponse>(
        buildStartAccountCsvImportUrl(accountId),
        buildStartAccountCsvImportPayload(key),
      ),
  });
};

export default useStartAccountCsvImport;
