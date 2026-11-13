import { z } from 'zod'

import { tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Crypto wallets (`kind: 'crypto_wallet'` manual assets): balances read from public addresses by
 * the server, from the operator's explorer, and valued in USD once a day. The app only ever sends
 * a public address (or a Bitcoin xpub/ypub/zpub); a private key or recovery phrase is refused
 * before it leaves the device (`looksLikeWalletSecret`) and again by the API.
 */

const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const CRYPTO_CHAINS = ['bitcoin', 'ethereum'] as const
export type CryptoChain = (typeof CRYPTO_CHAINS)[number]
export const cryptoChainSchema = z.enum(CRYPTO_CHAINS)

export const CRYPTO_ADDRESS_ERROR_CODES = ['timeout', 'rate_limited', 'unavailable', 'rejected', 'invalid_response', 'disabled'] as const
export type CryptoAddressErrorCode = (typeof CRYPTO_ADDRESS_ERROR_CODES)[number] | 'unknown'

export const cryptoWalletTokenSchema = z.object({
  cryptoWalletTokenKey: positiveSafeId,
  native: z.boolean(),
  /** The ERC-20 contract; null for a native coin. */
  contractAddress: z.string().nullable(),
  symbol: z.string().min(1),
  name: z.string().nullable(),
  /** An exact decimal string ("0.01234567"); never turned into a float for display. */
  quantity: z.string().min(1),
  tracked: z.boolean(),
  /** Ticked, with a balance, and no price at the last sync. */
  priceMissing: z.boolean(),
})

export const cryptoWalletAddressSchema = z.object({
  cryptoWalletAddressKey: positiveSafeId,
  // A chain a newer API adds reads as "unknown" rather than failing the asset.
  chain: tolerantEnum(CRYPTO_CHAINS, 'unknown'),
  kind: tolerantEnum(['address', 'xpub'], 'address'),
  address: z.string().min(1),
  label: z.string().nullable(),
  status: tolerantEnum(['pending', 'ok', 'failed'], 'pending'),
  /** Why the last attempt failed; null unless `status` is `failed`. */
  errorCode: tolerantEnum(CRYPTO_ADDRESS_ERROR_CODES, 'unknown').nullable(),
  lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  /** The last successful read: the balances are as of then. */
  lastSyncedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Native first, then by symbol. */
  tokens: z.array(cryptoWalletTokenSchema),
})

export const cryptoWalletSchema = z.object({
  addresses: z.array(cryptoWalletAddressSchema),
  /** The latest successful sync of any address; null before the first. */
  lastSyncedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Ticked tokens with a balance but no price at the last sync: today's value was not updated. */
  unpricedSymbols: z.array(z.string()),
})

export type CryptoWalletDto = z.infer<typeof cryptoWalletSchema>
export type CryptoWalletAddressDto = z.infer<typeof cryptoWalletAddressSchema>
export type CryptoWalletTokenDto = z.infer<typeof cryptoWalletTokenSchema>

// Write side: strict, only what the API takes.
export const cryptoWalletAddressWriteSchema = z.object({
  chain: cryptoChainSchema,
  address: z.string().trim().min(1).max(200),
  label: z.string().trim().max(100).nullable().optional(),
}).strict()

export const cryptoWalletCreateWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  isPrivate: z.boolean().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  addresses: z.array(cryptoWalletAddressWriteSchema).min(1).max(20),
}).strict()

export const cryptoWalletAddressLabelWriteSchema = z.object({ label: z.string().trim().max(100).nullable() }).strict()
export const cryptoWalletTokenWriteSchema = z.object({ tracked: z.boolean() }).strict()

export type CryptoWalletAddressWrite = z.input<typeof cryptoWalletAddressWriteSchema>
export type CryptoWalletCreateWrite = z.input<typeof cryptoWalletCreateWriteSchema>

export const MAX_WALLET_ADDRESSES = 20

const walletResponseSchema = z.object({ wallet: cryptoWalletSchema })

const assertId = (...ids: number[]) => {
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error('Positive safe ids are required.')
}

export function createCryptoWalletAddAddressEndpoint(assetId: number) {
  assertId(assetId)
  return writeEndpoint({ method: 'POST', path: `/v1/manual-assets/${assetId}/addresses`, schema: walletResponseSchema, successStatuses: [201] })
}

export function createCryptoWalletAddressLabelEndpoint(assetId: number, addressId: number) {
  assertId(assetId, addressId)
  return writeEndpoint({ method: 'PATCH', path: `/v1/manual-assets/${assetId}/addresses/${addressId}`, schema: walletResponseSchema, successStatuses: [200] })
}

export function createCryptoWalletRemoveAddressEndpoint(assetId: number, addressId: number) {
  assertId(assetId, addressId)
  return writeEndpoint({ method: 'DELETE', path: `/v1/manual-assets/${assetId}/addresses/${addressId}`, schema: walletResponseSchema, successStatuses: [200] })
}

export function createCryptoWalletTokenEndpoint(assetId: number, tokenId: number) {
  assertId(assetId, tokenId)
  return writeEndpoint({ method: 'PATCH', path: `/v1/manual-assets/${assetId}/tokens/${tokenId}`, schema: walletResponseSchema, successStatuses: [200] })
}

export function createCryptoWalletSyncEndpoint(assetId: number) {
  assertId(assetId)
  return writeEndpoint({ method: 'POST', path: `/v1/manual-assets/${assetId}/sync`, schema: z.object({ queued: z.literal(true) }), successStatuses: [202] })
}
