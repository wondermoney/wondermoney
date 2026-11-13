import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createCryptoWalletAddAddressEndpoint,
  createCryptoWalletAddressLabelEndpoint,
  createCryptoWalletRemoveAddressEndpoint,
  createCryptoWalletSyncEndpoint,
  createCryptoWalletTokenEndpoint,
  cryptoWalletAddressLabelWriteSchema,
  cryptoWalletAddressWriteSchema,
  cryptoWalletCreateWriteSchema,
  cryptoWalletTokenWriteSchema,
  type CryptoWalletAddressWrite,
  type CryptoWalletCreateWrite,
} from './crypto-wallet-contract'
import { walletSecretIndexes } from './crypto-wallet-forms-model'
import {
  createManualAssetDeleteEndpoint,
  createManualAssetUpdateEndpoint,
  cryptoWalletCreateEndpoint,
  cryptoWalletUpdateWriteSchema,
  type CryptoWalletUpdateWrite,
} from './manual-assets-contract'
import { classifyManualAssetWriteFailure, isLoanQueryOfEpoch, refreshAfterWrite, type ManualAssetWriteFailure } from './use-manual-asset-writes'

export type CryptoWalletWriteFailureKind =
  | ManualAssetWriteFailure
  | 'secret-rejected'
  | 'address-invalid'
  | 'address-exists'
  | 'feature-disabled'

/** Why a wallet write failed, and which of the sent addresses it is about when the API says. */
export type CryptoWalletWriteFailure = Readonly<{ kind: CryptoWalletWriteFailureKind; addressIndex: number | null }>

/**
 * Thrown before anything is sent when an address looks like a private key or a recovery phrase.
 * It carries the indexes only, never the value.
 */
export class WalletSecretBlockedError extends Error {
  readonly addressIndexes: readonly number[]
  constructor(addressIndexes: readonly number[]) {
    super('A wallet secret was blocked before sending.')
    this.name = 'WalletSecretBlockedError'
    this.addressIndexes = addressIndexes
  }
}

const API_CODES: Record<string, CryptoWalletWriteFailureKind> = {
  crypto_wallet_secret_rejected: 'secret-rejected',
  crypto_wallet_address_invalid: 'address-invalid',
  crypto_wallet_address_exists: 'address-exists',
  feature_disabled: 'feature-disabled',
}

export function classifyCryptoWalletWriteFailure(error: unknown): CryptoWalletWriteFailure {
  if (error instanceof WalletSecretBlockedError) return { kind: 'secret-rejected', addressIndex: error.addressIndexes[0] ?? null }
  const addressIndex = error instanceof ApiError && error.addressIndex !== undefined ? error.addressIndex : null
  if (error instanceof ApiError && error.code === 'http') {
    const known = error.serverCode === undefined ? undefined : API_CODES[error.serverCode]
    if (known) return { kind: known, addressIndex }
    // A chain whose explorer the operator has not configured.
    if (error.status === 501) return { kind: 'feature-disabled', addressIndex }
  }
  return { kind: classifyManualAssetWriteFailure(error), addressIndex }
}

function useWalletRuntime(name: string) {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error(`${name} requires an authenticated runtime`)
  const queryClient = useQueryClient()
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
  }
  return { runtime, queryClient, onError }
}

const refuseSecrets = (addresses: readonly { address: string }[]) => {
  const indexes = walletSecretIndexes(addresses)
  if (indexes.length > 0) throw new WalletSecretBlockedError(indexes)
}

/** Add crypto wallet. An address that looks like a secret stops it before the request. */
export function useCreateCryptoWallet() {
  const { runtime, queryClient, onError } = useWalletRuntime('useCreateCryptoWallet')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (value: CryptoWalletCreateWrite) => {
      refuseSecrets(value.addresses)
      const body = cryptoWalletCreateWriteSchema.parse(value)
      return runtime.apiClient.write(cryptoWalletCreateEndpoint, { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId) })
    },
    onError,
  })
}

export function useAddCryptoWalletAddress() {
  const { runtime, queryClient, onError } = useWalletRuntime('useAddCryptoWalletAddress')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, value }: { assetId: number; value: CryptoWalletAddressWrite }) => {
      refuseSecrets([value])
      const body = cryptoWalletAddressWriteSchema.parse(value)
      return runtime.apiClient.write(createCryptoWalletAddAddressEndpoint(assetId), { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    },
    onError,
  })
}

export function useSetCryptoWalletAddressLabel() {
  const { runtime, queryClient, onError } = useWalletRuntime('useSetCryptoWalletAddressLabel')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, addressId, label }: { assetId: number; addressId: number; label: string | null }) => {
      const trimmed = label?.trim() ?? ''
      const body = cryptoWalletAddressLabelWriteSchema.parse({ label: trimmed === '' ? null : trimmed })
      return runtime.apiClient.write(createCryptoWalletAddressLabelEndpoint(assetId, addressId), { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    },
    onError,
  })
}

export function useRemoveCryptoWalletAddress() {
  const { runtime, queryClient, onError } = useWalletRuntime('useRemoveCryptoWalletAddress')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, addressId }: { assetId: number; addressId: number }) => (
      runtime.apiClient.write(createCryptoWalletRemoveAddressEndpoint(assetId, addressId), { commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    ),
    onError,
  })
}

/** Tick a token to count it in the wallet's value, or untick it to leave it out. */
export function useSetCryptoWalletTokenTracked() {
  const { runtime, queryClient, onError } = useWalletRuntime('useSetCryptoWalletTokenTracked')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, tokenId, tracked }: { assetId: number; tokenId: number; tracked: boolean }) => {
      const body = cryptoWalletTokenWriteSchema.parse({ tracked })
      return runtime.apiClient.write(createCryptoWalletTokenEndpoint(assetId, tokenId), { body, commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    },
    onError,
  })
}

/** "Sync now": queues a read of every address; the balances arrive with a later refresh. */
export function useSyncCryptoWallet() {
  const { runtime, queryClient, onError } = useWalletRuntime('useSyncCryptoWallet')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId }: { assetId: number }) => (
      runtime.apiClient.write(createCryptoWalletSyncEndpoint(assetId), { commit: () => refreshAfterWrite(queryClient, runtime.epochId, assetId) })
    ),
    onError,
  })
}

/**
 * Edit wallet (its name, its notes, and for the owner its privacy), and Archive or Bring back
 * (`{ archived }`), all through the asset PATCH. The wallet, the list, net worth and the loans
 * refresh once it commits: a loan secured against the wallet shows its name and value.
 */
export function useUpdateCryptoWallet() {
  const { runtime, queryClient, onError } = useWalletRuntime('useUpdateCryptoWallet')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId, value }: { assetId: number; value: CryptoWalletUpdateWrite }) => {
      const body = cryptoWalletUpdateWriteSchema.parse(value)
      return runtime.apiClient.write(createManualAssetUpdateEndpoint(assetId), {
        body,
        commit: () => {
          refreshAfterWrite(queryClient, runtime.epochId, assetId)
          void queryClient.invalidateQueries({ predicate: isLoanQueryOfEpoch(runtime.epochId) })
        },
      })
    },
    onError,
  })
}

/**
 * Remove the wallet. The list, net worth and the loans (which lose any link to it) refresh; the
 * wallet's own page is not refetched, since it would only answer 404 now (as on the web).
 */
export function useDeleteCryptoWallet() {
  const { runtime, queryClient, onError } = useWalletRuntime('useDeleteCryptoWallet')
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ assetId }: { assetId: number }) => (
      runtime.apiClient.write(createManualAssetDeleteEndpoint(assetId), {
        commit: () => {
          refreshAfterWrite(queryClient, runtime.epochId)
          void queryClient.invalidateQueries({ predicate: isLoanQueryOfEpoch(runtime.epochId) })
        },
      })
    ),
    onError,
  })
}
