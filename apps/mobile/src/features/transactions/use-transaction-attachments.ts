import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { File, UploadType } from 'expo-file-system'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  confirmTransactionAttachmentEndpoint,
  createTransactionAttachmentUploadUrlEndpoint,
  deleteTransactionAttachmentEndpoint,
  type PickedAttachment,
  TRANSACTION_ATTACHMENT_MAX_FILES,
  TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES,
  transactionAttachmentsEndpoint,
} from './transaction-attachments-contract'
import { transactionAttachmentsKey, transactionsRootKey } from './query-keys'

/** Why an attachment action could not finish, in the terms the screen shows. */
export type AttachmentFailure = 'limit' | 'size' | 'type' | 'access' | 'network' | 'general'

const ALLOWED_TYPES = new Set(['application/pdf', 'image/heic', 'image/heif', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export function classifyAttachmentFailure(error: unknown): AttachmentFailure {
  if (error instanceof AttachmentValidationError) return error.reason
  if (!(error instanceof Error)) return 'general'
  const status = (error as { status?: number }).status
  if (status === 401 || status === 403) return 'access'
  if (error.name === 'TypeError' || /network|fetch/i.test(error.message)) return 'network'
  return 'general'
}

export class AttachmentValidationError extends Error {
  readonly reason: AttachmentFailure

  constructor(reason: AttachmentFailure) {
    super(`Attachment rejected: ${reason}`)
    this.name = 'AttachmentValidationError'
    this.reason = reason
  }
}

/** The transaction's attachments, with a short-lived URL per file. */
export function useTransactionAttachments(transactionId: number, enabled = true) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useTransactionAttachments requires an authenticated runtime')
  return useQuery({
    queryKey: transactionAttachmentsKey(runtime.epochId, transactionId),
    queryFn: () => runtime.apiClient.read(transactionAttachmentsEndpoint(transactionId)),
    enabled: enabled && Number.isSafeInteger(transactionId) && transactionId > 0,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Uploads one picked file: a presigned PUT straight to the store, then a confirm so the API
 * checks the real size and the file's own bytes before recording it.
 */
export function useUploadTransactionAttachment(transactionId: number, currentCount: number) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useUploadTransactionAttachment requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: 0,
    mutationFn: async (picked: PickedAttachment) => {
      if (currentCount >= TRANSACTION_ATTACHMENT_MAX_FILES) throw new AttachmentValidationError('limit')
      if (picked.sizeBytes <= 0) throw new AttachmentValidationError('general')
      if (picked.sizeBytes > TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES) throw new AttachmentValidationError('size')
      if (!ALLOWED_TYPES.has(picked.mimeType)) throw new AttachmentValidationError('type')

      const upload = await runtime.apiClient.write(createTransactionAttachmentUploadUrlEndpoint(transactionId), {
        body: { contentType: picked.mimeType, fileName: picked.name, sizeBytes: picked.sizeBytes },
        commit: () => undefined,
      })

      await new File(picked.uri).upload(upload.presignedUrl, {
        headers: upload.uploadHeaders,
        httpMethod: 'PUT',
        mimeType: picked.mimeType,
        uploadType: UploadType.BINARY_CONTENT,
      })

      return runtime.apiClient.write(confirmTransactionAttachmentEndpoint(transactionId), {
        body: { fileName: picked.name, key: upload.key },
        commit: () => {
          void queryClient.invalidateQueries({ queryKey: transactionAttachmentsKey(runtime.epochId, transactionId) })
          void queryClient.invalidateQueries({ queryKey: transactionsRootKey(runtime.epochId) })
        },
      })
    },
  })
}

export function useDeleteTransactionAttachment(transactionId: number) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useDeleteTransactionAttachment requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: 0,
    mutationFn: (attachmentId: number) => runtime.apiClient.write(deleteTransactionAttachmentEndpoint(transactionId, attachmentId), {
      commit: () => {
        void queryClient.invalidateQueries({ queryKey: transactionAttachmentsKey(runtime.epochId, transactionId) })
        void queryClient.invalidateQueries({ queryKey: transactionsRootKey(runtime.epochId) })
      },
    }),
  })
}
