import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/** Mirrors core/api's transaction-attachment service: 10 files, 10 MB each. */
export const TRANSACTION_ATTACHMENT_MAX_FILES = 10
export const TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024

const positiveId = z.number().int().positive()

export const transactionAttachmentSchema = z.object({
  transactionAttachmentKey: positiveId,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  /** A short-lived presigned GET link. */
  url: z.string(),
})
export type TransactionAttachmentDto = z.infer<typeof transactionAttachmentSchema>

const transactionAttachmentsResponseSchema = z.object({
  attachments: z.array(transactionAttachmentSchema),
})

const uploadUrlResponseSchema = z.object({
  key: z.string(),
  presignedUrl: z.string(),
  uploadHeaders: z.record(z.string(), z.string()),
  uploadMethod: z.literal('PUT'),
  expiresInSeconds: z.number().int().positive(),
})
export type TransactionAttachmentUploadUrl = z.infer<typeof uploadUrlResponseSchema>

export const transactionAttachmentsEndpoint = (transactionId: number) => readEndpoint({
  method: 'GET',
  path: `/v1/account/transaction/${transactionId}/attachments`,
  schema: transactionAttachmentsResponseSchema,
})

export const createTransactionAttachmentUploadUrlEndpoint = (transactionId: number) => writeEndpoint({
  method: 'POST',
  path: `/v1/account/transaction/${transactionId}/attachments/upload-url`,
  schema: uploadUrlResponseSchema,
})

export const confirmTransactionAttachmentEndpoint = (transactionId: number) => writeEndpoint({
  method: 'POST',
  path: `/v1/account/transaction/${transactionId}/attachments`,
  schema: transactionAttachmentSchema,
  successStatuses: [201],
})

export const deleteTransactionAttachmentEndpoint = (transactionId: number, attachmentId: number) => writeEndpoint({
  method: 'DELETE',
  path: `/v1/account/transaction/${transactionId}/attachments/${attachmentId}`,
  schema: z.undefined(),
  successStatuses: [204],
})

/** The types the API accepts, for the pickers. */
export const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/heic', 'image/jpeg', 'image/png', 'image/webp'] as const

export type PickedAttachment = Readonly<{
  uri: string
  name: string
  mimeType: string
  sizeBytes: number
}>

/** A file name with an extension the server recognises, so the stored name opens as what it is. */
export function attachmentFileName(name: string, mimeType: string, fallback = 'attachment'): string {
  const base = name.trim() || fallback
  if (/\.[a-z0-9]{2,5}$/iu.test(base)) return base
  const extension = mimeType === 'application/pdf'
    ? 'pdf'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/heic'
          ? 'heic'
          : 'jpg'
  return `${base}.${extension}`
}
