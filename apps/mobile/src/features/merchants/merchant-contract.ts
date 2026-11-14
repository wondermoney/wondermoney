import { z } from 'zod'

/**
 * A household URL field the API may send on a merchant. A value that is not a string reads as
 * absent rather than failing the list it sits in: a broken logo must never hide a transaction.
 */
const optionalUrl = z.string().max(2048).nullable().optional().catch(null)

/**
 * The fields the merchant DTO added for logos (issue #45). All optional: a server from before
 * them sends only `{ name }` on a transaction row and `{ transactionMerchantKey, name }` in the
 * merchants list, and both still parse.
 *
 * - `website` / `logoUrl`: what the household set (shown in an edit form).
 * - `resolvedLogoUrl`: the one image to render, or null for the initial-letter avatar. Either the
 *   household's own third-party logo (loaded without credentials) or the API's logo proxy
 *   (loaded with the bearer token; see `components/ui/merchant-avatar`).
 */
export const merchantLogoFields = {
  website: optionalUrl,
  logoUrl: optionalUrl,
  resolvedLogoUrl: optionalUrl,
} as const

/** The merchant on a transaction row (`transactionMerchantKey`), absent when the row has none. */
export const transactionRowMerchantSchema = z.object({
  transactionMerchantKey: z.number().int().positive().optional().catch(undefined),
  name: z.string().min(1).max(200),
  ...merchantLogoFields,
})

export type TransactionRowMerchantDto = z.infer<typeof transactionRowMerchantSchema>
