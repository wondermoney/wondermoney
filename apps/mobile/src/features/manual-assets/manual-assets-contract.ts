import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

import { cryptoWalletSchema } from './crypto-wallet-contract'

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

/** The kinds valued by hand, which Add asset offers. */
export const MANUAL_ASSET_KINDS = ['property', 'vehicle', 'valuable', 'other'] as const
export type ManualAssetKind = (typeof MANUAL_ASSET_KINDS)[number]
// Write side: only a kind this build knows. A crypto wallet has its own create endpoint, and its
// kind can never be set on a plain asset or changed later.
export const manualAssetKindSchema = z.enum(MANUAL_ASSET_KINDS)

/** Every kind the list and detail read: the hand-valued ones and a crypto wallet. */
export const ASSET_KINDS = [...MANUAL_ASSET_KINDS, 'crypto_wallet'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const isCryptoWallet = (asset: { kind: AssetKind }): boolean => asset.kind === 'crypto_wallet'

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
  kind: tolerantEnum(ASSET_KINDS, 'other'),
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
  /** The addresses and tokens of a crypto wallet; null for every other kind and absent on an older API. */
  wallet: cryptoWalletSchema.nullable().default(null),
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
  // The start date is optional: without one the change runs from the latest valuation.
  growthRule: z.object({ annualRatePercent: z.number().finite().gt(-100).max(1000), startDate: day.optional() }).strict().optional(),
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

/** A crypto wallet: its public addresses; its first value comes with the first sync (`value: null` until then). */
export const cryptoWalletCreateEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/manual-assets/crypto-wallets',
  schema: z.object({ asset: manualAssetSchema, wallet: cryptoWalletSchema }),
  successStatuses: [201],
})

/**
 * What a wallet's page changes on it, as web's: its name, its notes (null clears them), its privacy
 * (the owner only), and `archived` alone for Archive or Bring back. The rest of the PATCH (kind,
 * value fields) does not apply to a wallet and is never sent from here.
 */
export const cryptoWalletUpdateWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  isPrivate: z.boolean().optional(),
  archived: z.boolean().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined))

export type CryptoWalletUpdateWrite = z.input<typeof cryptoWalletUpdateWriteSchema>

/**
 * Edit asset (web's `ManualAssetFormDrawer` with an asset): what a hand-valued asset's PATCH
 * changes. Only the fields that changed are sent; null clears an optional one. The currency, the
 * value and its date are not here: every valuation is in the currency, and the value changes
 * through Update value, which keeps the history. `isPrivate` is the owner's alone (the API answers
 * 403 to anyone else), and `archived` alone is Archive or Bring back.
 */
export const manualAssetUpdateWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  kind: manualAssetKindSchema.optional(),
  purchasePrice: money.nonnegative().nullable().optional(),
  purchaseDate: day.nullable().optional(),
  growthRule: z.object({ annualRatePercent: z.number().finite().gt(-100).max(1000), startDate: day.nullable() }).strict().nullable().optional(),
  isPrivate: z.boolean().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  archived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

export type ManualAssetUpdateWrite = z.input<typeof manualAssetUpdateWriteSchema>

export function createManualAssetUpdateEndpoint(assetId: number) {
  if (!isValidManualAssetId(assetId)) throw new Error('A positive safe asset id is required.')
  return writeEndpoint({ method: 'PATCH', path: `/v1/manual-assets/${assetId}`, schema: z.object({ asset: manualAssetSchema }), successStatuses: [200] })
}

/** Delete the asset and its history (204, no body). */
export function createManualAssetDeleteEndpoint(assetId: number) {
  if (!isValidManualAssetId(assetId)) throw new Error('A positive safe asset id is required.')
  return writeEndpoint({ method: 'DELETE', path: `/v1/manual-assets/${assetId}`, schema: z.undefined(), successStatuses: [204] })
}

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
