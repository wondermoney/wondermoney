import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * The API's manually valued assets (`/v1/manual-assets`): homes, vehicles and valuables the
 * household values by hand. Every amount is in the asset's own currency except
 * `valueInUserCurrency` and the list summary, which the API converts; the app never converts.
 * A private asset of the other household member never reaches this client (the API answers 404).
 */

const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const currencyCode = z.string().regex(/^[A-Z]{3}$/)
const day = z.iso.date()
const money = z.number().finite()

export const MANUAL_ASSET_KINDS = ['property', 'vehicle', 'valuable', 'other'] as const
export type ManualAssetKind = (typeof MANUAL_ASSET_KINDS)[number]
// Write side: only a kind this build knows.
export const manualAssetKindSchema = z.enum(MANUAL_ASSET_KINDS)

export const manualAssetValuationSchema = z.object({
  manualAssetValuationKey: positiveSafeId,
  date: day,
  value: money,
  note: z.string().nullable(),
})

/**
 * A loan secured against the asset. `outstandingPrincipal` is in the loan's own `currency`;
 * `outstandingPrincipalInAssetCurrency` is the API's conversion into the asset's currency, null
 * when there is no exchange rate for the pair.
 */
export const manualAssetLinkedLoanSchema = z.object({
  loanKey: positiveSafeId,
  name: z.string().min(1),
  currency: currencyCode,
  outstandingPrincipal: money,
  outstandingPrincipalInAssetCurrency: money.nullable(),
})

export const manualAssetSchema = z.object({
  manualAssetKey: positiveSafeId,
  name: z.string().min(1),
  // A kind a newer API adds reads as "other" rather than failing the list.
  kind: tolerantEnum(MANUAL_ASSET_KINDS, 'other'),
  notes: z.string().nullable(),
  currency: currencyCode,
  currencyKey: positiveSafeId,
  isPrivate: z.boolean(),
  isOwner: z.boolean(),
  ownerFirstName: z.string().nullable(),
  archived: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  purchaseDate: day.nullable(),
  purchasePrice: money.nullable(),
  growthRule: z.object({ annualRatePercent: z.number().finite(), startDate: day.nullable() }).nullable(),
  /** Today's value in `currency`; null for an archived asset. */
  value: money.nullable(),
  /** `value` in `userCurrency`; null when there is no value or no exchange rate. */
  valueInUserCurrency: money.nullable(),
  userCurrency: currencyCode,
  lastValuation: manualAssetValuationSchema.nullable(),
  // Equity. An API from before loans could secure an asset sends none of these four, which reads
  // as an asset with no loans against it.
  linkedLoans: z.array(manualAssetLinkedLoanSchema).default([]),
  /** The linked loans' outstanding principal in `currency`: 0 with none, null when any has no exchange rate. */
  linkedDebt: money.nullable().default(null),
  /** `value` less `linkedDebt`, in `currency`; null when either is null. */
  equity: money.nullable().default(null),
  /** Sorted codes of linked loans whose principal could not be converted into `currency`. */
  unconvertedLoanCurrencies: z.array(currencyCode).default([]),
})

export const manualAssetsResponseSchema = z.object({
  assets: z.array(manualAssetSchema),
  summary: z.object({
    currencyCode,
    isComplete: z.boolean(),
    totalValue: money,
    unconvertedAssets: z.number().int().nonnegative(),
    unconvertedCurrencies: z.array(currencyCode),
  }),
})

export const manualAssetResponseSchema = z.object({
  asset: manualAssetSchema,
  /** Newest first. */
  valuations: z.array(manualAssetValuationSchema),
  /** The value chart's points, oldest first, in the asset's currency. */
  history: z.array(z.object({ date: day, value: money })),
})

export const manualAssetCreateWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  kind: manualAssetKindSchema,
  currencyKey: positiveSafeId,
  value: money.nonnegative(),
  valuationDate: day,
  purchaseDate: day.optional(),
  purchasePrice: money.nonnegative().optional(),
  isPrivate: z.boolean(),
  notes: z.string().max(10_000).optional(),
  growthRule: z.object({ annualRatePercent: z.number().finite().gt(-100).max(1000) }).strict().optional(),
}).strict()

export const manualAssetValuationWriteSchema = z.object({
  value: money.nonnegative(),
  date: day,
  note: z.string().max(2000).optional(),
}).strict()

export type ManualAssetDto = z.infer<typeof manualAssetSchema>
export type ManualAssetLinkedLoanDto = z.infer<typeof manualAssetLinkedLoanSchema>
export type ManualAssetValuationDto = z.infer<typeof manualAssetValuationSchema>
export type ManualAssetsResponse = z.infer<typeof manualAssetsResponseSchema>
export type ManualAssetResponse = z.infer<typeof manualAssetResponseSchema>
export type ManualAssetCreateWrite = z.input<typeof manualAssetCreateWriteSchema>
export type ManualAssetValuationWrite = z.input<typeof manualAssetValuationWriteSchema>

export const manualAssetsEndpoint = readEndpoint({ method: 'GET', path: '/v1/manual-assets', schema: manualAssetsResponseSchema })

export const manualAssetCreateEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/manual-assets',
  schema: z.object({ asset: manualAssetSchema }),
  successStatuses: [201],
})

export const isValidManualAssetId = (value: number): boolean => Number.isSafeInteger(value) && value > 0

export function parseManualAssetId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return isValidManualAssetId(parsed) ? parsed : null
}

export function createManualAssetEndpoint(assetId: number) {
  if (!isValidManualAssetId(assetId)) throw new Error('A positive safe asset id is required.')
  return readEndpoint({ method: 'GET', path: `/v1/manual-assets/${assetId}`, schema: manualAssetResponseSchema })
}

/** Record a valuation. A second one for the same day replaces the first, so 200 is a success too. */
export function createManualAssetValuationEndpoint(assetId: number) {
  if (!isValidManualAssetId(assetId)) throw new Error('A positive safe asset id is required.')
  return writeEndpoint({
    method: 'POST',
    path: `/v1/manual-assets/${assetId}/valuations`,
    schema: z.object({ asset: manualAssetSchema, valuation: manualAssetValuationSchema }),
    successStatuses: [200, 201],
  })
}
