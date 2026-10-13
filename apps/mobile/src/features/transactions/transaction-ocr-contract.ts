import { z } from 'zod'

import { writeEndpoint } from '@/lib/api/runtime-schema'

const positiveId = z.number().int().positive()

/** Mirrors core/api's OCR_UPLOAD_ALLOWED_MIME_TYPES (middleware/multer.ts) and the 5 MB
 * multer.limits.fileSize used for the receipt-scan upload. */
export const OCR_UPLOAD_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
export const OCR_UPLOAD_MAX_BYTES = 5_000_000

const ocrScanResponseSchema = z.object({
  transactionOcrImportId: positiveId,
  transactionInfo: z.object({
    settlementAmount: z.number().finite(),
    settlementCurrencyId: positiveId.optional(),
    transactionDate: z.string().min(1),
    transactionMerchantId: positiveId.optional(),
    transactionMerchantName: z.string(),
  }).strict(),
}).strict()
export type TransactionOcrScanDto = z.infer<typeof ocrScanResponseSchema>

/** POST /v1/account/transaction/ocr — a raw multipart/form-data upload (the only mobile endpoint
 * that isn't a plain JSON body; see fetch-transport.ts's FormData passthrough). */
export const transactionOcrScanEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/account/transaction/ocr',
  schema: ocrScanResponseSchema,
})

export type TransactionOcrFile = Readonly<{ uri: string; name: string; mimeType: string }>

/** multer's single-file middleware (upload.single('file')) expects exactly one multipart part
 * named "file" — matching web's `formData.append("file", file)`. */
export function buildTransactionOcrFormData(file: TransactionOcrFile): FormData {
  const formData = new FormData()
  formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob)
  return formData
}

export type ConfirmTransactionOcrDraft = Readonly<{
  transactionOcrImportId: number
  accountId: number
  transactionTypeId: number
  transactionDate: string
  settlementAmount: string
  settlementCurrencyId: number
  existingMerchantId?: number | null
  newMerchantName?: string
  categoryId?: number | null
  description?: string
}>

export type FrozenConfirmTransactionOcr = Readonly<{
  transactionOcrImportId: number
  payload: Readonly<{
    accountId: number
    transactionTypeId: number
    transactionDate: string
    settlementAmount: string
    settlementCurrencyId: number
    transactionMerchantId?: number
    transactionMerchantName?: string
    categoryIds?: number[]
    description?: string
  }>
}>

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const unsignedPositiveAmount = z.string().trim().regex(/^(?:\d+\.?\d*|\.\d+)$/).refine((value) => {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
})
const boundedName = z.string().trim().min(1).max(200)

const todayDateOnly = (now: Date): string => {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parsePastOrPresentDate = (value: string, now: Date): string => {
  const parsed = dateOnly.parse(value)
  const instant = new Date(`${parsed}T12:00:00.000Z`)
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== parsed || parsed > todayDateOnly(now)) {
    throw new Error('Transaction date must be a real, nonfuture date.')
  }
  return instant.toISOString()
}

/** Resolves an edited, OCR-prefilled draft into the exact confirm-endpoint body
 * (PUT /v1/account/transaction/ocr/{id}/confirm), matching core/api's
 * acceptTransactionOCRImportRequestSchema. */
export function freezeConfirmTransactionOcr(draft: ConfirmTransactionOcrDraft, now = new Date()): FrozenConfirmTransactionOcr {
  const transactionOcrImportId = positiveId.parse(draft.transactionOcrImportId)
  const accountId = positiveId.parse(draft.accountId)
  const transactionTypeId = positiveId.parse(draft.transactionTypeId)
  const transactionDate = parsePastOrPresentDate(draft.transactionDate, now)
  const settlementAmount = unsignedPositiveAmount.parse(draft.settlementAmount)
  const settlementCurrencyId = positiveId.parse(draft.settlementCurrencyId)
  const existingMerchantId = draft.existingMerchantId == null ? null : positiveId.parse(draft.existingMerchantId)
  const newMerchantName = draft.newMerchantName?.trim() ?? ''
  const merchant = existingMerchantId !== null
    ? { transactionMerchantId: existingMerchantId }
    : newMerchantName.length > 0
      ? { transactionMerchantName: boundedName.parse(newMerchantName) }
      : null
  if (!merchant) throw new Error('Choose an existing merchant or enter a new merchant name.')

  const categoryId = draft.categoryId == null ? null : positiveId.parse(draft.categoryId)
  const description = draft.description?.trim() ?? ''
  if (description.length > 500) throw new Error('Description is too long.')

  return Object.freeze({
    transactionOcrImportId,
    payload: Object.freeze({
      accountId,
      transactionTypeId,
      transactionDate,
      settlementAmount,
      settlementCurrencyId,
      ...merchant,
      ...(categoryId === null ? {} : { categoryIds: [categoryId] }),
      ...(description ? { description } : {}),
    }),
  })
}

export function createConfirmTransactionOcrEndpoint(transactionOcrImportId: number) {
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/account/transaction/ocr/${positiveId.parse(transactionOcrImportId)}/confirm`,
    schema: z.undefined(),
    successStatuses: [201],
  })
}

export function createRejectTransactionOcrEndpoint(transactionOcrImportId: number) {
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/account/transaction/ocr/${positiveId.parse(transactionOcrImportId)}/reject`,
    schema: z.undefined(),
  })
}
