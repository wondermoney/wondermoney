import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import api from "../api";

export const TRANSACTION_ATTACHMENT_MAX_FILES = 10;
export const TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export interface TransactionAttachment {
  transactionAttachmentKey: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** A short-lived presigned GET link. */
  url: string;
}

interface AttachmentsResponse {
  attachments: TransactionAttachment[];
}

interface UploadUrlResponse {
  key: string;
  presignedUrl: string;
  uploadHeaders: Record<string, string>;
  uploadMethod: "PUT";
  expiresInSeconds: number;
}

const attachmentsKey = (transactionKey: number) => [
  "transaction-attachments",
  transactionKey,
];

async function getTransactionAttachments(
  transactionKey: number,
): Promise<TransactionAttachment[]> {
  const { data } = await api.get<AttachmentsResponse>(
    `/v1/account/transaction/${transactionKey}/attachments`,
  );
  return Array.isArray(data?.attachments) ? data.attachments : [];
}

export function useTransactionAttachments(
  transactionKey: number,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: attachmentsKey(transactionKey),
    queryFn: () => getTransactionAttachments(transactionKey),
    enabled: options.enabled ?? true,
    // A presigned URL expires in minutes, so a stale list would show dead thumbnails.
    staleTime: 60 * 1000,
  });
}

/**
 * The whole upload: ask for a presigned PUT, send the bytes straight to the store, then confirm
 * so the API checks the real size and the file's own bytes before recording it.
 */
export function useUploadTransactionAttachment(transactionKey: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { data: upload } = await api.post<UploadUrlResponse>(
        `/v1/account/transaction/${transactionKey}/attachments/upload-url`,
        {
          contentType: file.type,
          fileName: file.name,
          sizeBytes: file.size,
        },
      );
      await axios.put(upload.presignedUrl, file, {
        headers: upload.uploadHeaders,
      });
      const { data: attachment } = await api.post<TransactionAttachment>(
        `/v1/account/transaction/${transactionKey}/attachments`,
        { fileName: file.name, key: upload.key },
      );
      return attachment;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: attachmentsKey(transactionKey),
      });
      // The ledger row's paperclip comes from the transaction list.
      void queryClient.invalidateQueries({
        queryKey: ["accounts-transactions"],
      });
    },
  });
}

export function useDeleteTransactionAttachment(transactionKey: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: number) =>
      api.delete(
        `/v1/account/transaction/${transactionKey}/attachments/${attachmentId}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: attachmentsKey(transactionKey),
      });
      void queryClient.invalidateQueries({
        queryKey: ["accounts-transactions"],
      });
    },
  });
}

/** The ledger's paperclip marker: invalidated with the list, so a new file shows up on the row. */
export function invalidateTransactionAttachments(
  queryClient: ReturnType<typeof useQueryClient>,
  transactionKey: number,
) {
  return queryClient.invalidateQueries({
    queryKey: attachmentsKey(transactionKey),
  });
}
