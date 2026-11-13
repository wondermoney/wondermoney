import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { useLoanCurrencies } from '@/features/loans/use-loan-currencies'
import { ApiError } from '@/lib/api/errors'
import { useCryptoWalletChains } from '@/lib/server/use-instance'

import { AssetCreateScreen } from './asset-create-screen'
import { AssetDetailScreen, type AssetDetailViewState } from './asset-detail-screen'
import { AssetsScreen, type AssetsViewState } from './assets-screen'
import { CryptoWalletCreateScreen } from './crypto-wallet-create-screen'
import type { CryptoWalletActions } from './crypto-wallet-section'
import { parseManualAssetId } from './manual-assets-contract'
import {
  classifyCryptoWalletWriteFailure,
  useAddCryptoWalletAddress,
  useCreateCryptoWallet,
  useDeleteCryptoWallet,
  useRemoveCryptoWalletAddress,
  useSetCryptoWalletAddressLabel,
  useSetCryptoWalletTokenTracked,
  useSyncCryptoWallet,
  useUpdateCryptoWallet,
} from './use-crypto-wallet-writes'
import { classifyManualAssetWriteFailure, type ManualAssetWriteFailure, useCreateManualAsset, useRecordValuation } from './use-manual-asset-writes'
import { useManualAsset, useManualAssets } from './use-manual-assets'
import { ValuationScreen } from './valuation-screen'

const detailHref = (assetId: number) => ({ pathname: '/assets/[assetId]', params: { assetId: String(assetId) } }) as Href

export function AssetsRoute() {
  const query = useManualAssets()
  const router = useRouter()
  const walletChains = useCryptoWalletChains()
  let state: AssetsViewState
  if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', data: query.data, refreshing: query.isRefreshing }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  return <AssetsScreen
    state={state}
    onRefresh={async () => { await query.refetch() }}
    onOpenAsset={(assetId) => router.push(detailHref(assetId))}
    onCreateAsset={() => router.push('/assets/create' as Href)}
    // Only on a server that reads at least one chain.
    onCreateWallet={walletChains.length > 0 ? () => router.push('/assets/crypto-wallet' as Href) : undefined}
  />
}

export function AssetDetailRoute() {
  const params = useLocalSearchParams<{ assetId?: string | string[] }>()
  const assetId = parseManualAssetId(params.assetId)
  const query = useManualAsset(assetId)
  const router = useRouter()
  const wallet = useCryptoWalletActions(assetId, () => router.replace('/assets' as Href))
  let state: AssetDetailViewState
  if (query.isInvalidId) state = { status: 'invalid-id' }
  else if (query.isAccessTransition) state = { status: 'access-transition' }
  else if (query.isLoading) state = { status: 'loading' }
  else if (query.data) state = { status: query.isRefreshFailure ? 'refresh-error' : 'loaded', data: query.data, refreshing: query.isRefreshing }
  // The other member's private asset is a 404 too: it does not exist for this viewer.
  else if (query.isNotFound) state = { status: 'not-found' }
  else if (query.error instanceof ApiError && query.error.code === 'invalid-response') state = { status: 'invalid-response' }
  else state = { status: 'error' }
  return <AssetDetailScreen
    state={state}
    onBack={() => router.replace('/assets' as Href)}
    onRefresh={async () => { await query.refetch() }}
    onUpdateValue={() => { if (assetId !== null) router.push({ pathname: '/assets/[assetId]/value', params: { assetId: String(assetId) } } as Href) }}
    wallet={wallet}
  />
}

/** A wallet page's writes, each answering with why it failed (or null). */
function useCryptoWalletActions(assetId: number | null, onDeleted: () => void): CryptoWalletActions | undefined {
  const chains = useCryptoWalletChains()
  const toggle = useSetCryptoWalletTokenTracked()
  const add = useAddCryptoWalletAddress()
  const label = useSetCryptoWalletAddressLabel()
  const remove = useRemoveCryptoWalletAddress()
  const sync = useSyncCryptoWallet()
  const update = useUpdateCryptoWallet()
  const removeWallet = useDeleteCryptoWallet()
  if (assetId === null) return undefined
  const attempt = async (write: () => Promise<unknown>) => {
    try {
      await write()
      return null
    } catch (error) {
      return classifyCryptoWalletWriteFailure(error)
    }
  }
  return {
    chains,
    pending: toggle.isPending || add.isPending || label.isPending || remove.isPending || sync.isPending || update.isPending || removeWallet.isPending,
    onToggleToken: (tokenId, tracked) => attempt(() => toggle.mutateAsync({ assetId, tokenId, tracked })),
    onAddAddress: (value) => attempt(() => add.mutateAsync({ assetId, value })),
    onSetLabel: (addressId, next) => attempt(() => label.mutateAsync({ assetId, addressId, label: next })),
    onRemoveAddress: (addressId) => attempt(() => remove.mutateAsync({ assetId, addressId })),
    onSyncNow: () => attempt(() => sync.mutateAsync({ assetId })),
    onUpdateWallet: (value) => attempt(() => update.mutateAsync({ assetId, value })),
    onDeleteWallet: async () => {
      const outcome = await attempt(() => removeWallet.mutateAsync({ assetId }))
      if (outcome === null) onDeleted()
      return outcome
    },
  }
}

/** Add crypto wallet. On a server that reads no chain, the screen says so (the entry is hidden then). */
export function CryptoWalletCreateRoute() {
  const router = useRouter()
  const chains = useCryptoWalletChains()
  const mutation = useCreateCryptoWallet()
  const back = () => router.replace('/assets' as Href)
  return <CryptoWalletCreateScreen
    chains={chains}
    pending={mutation.isPending}
    onBack={back}
    onCreate={async (value) => {
      try {
        const { asset } = await mutation.mutateAsync(value)
        router.replace(detailHref(asset.manualAssetKey))
        return null
      } catch (error) {
        return classifyCryptoWalletWriteFailure(error)
      }
    }}
  />
}

export function AssetCreateRoute() {
  const router = useRouter()
  const currencies = useLoanCurrencies()
  const assets = useManualAssets()
  const mutation = useCreateManualAsset()
  const [outcome, setOutcome] = useState<ManualAssetWriteFailure | null>(null)
  return <AssetCreateScreen
    currencies={currencies.data?.currencies ?? []}
    userCurrency={assets.data?.summary.currencyCode ?? null}
    loading={currencies.isLoading}
    metadataError={!currencies.isLoading && !currencies.data}
    pending={mutation.isPending}
    outcome={outcome}
    onBack={() => router.replace('/assets' as Href)}
    onCreate={async (value) => {
      setOutcome(null)
      try {
        const { asset } = await mutation.mutateAsync(value)
        router.replace(detailHref(asset.manualAssetKey))
      } catch (error) {
        setOutcome(classifyManualAssetWriteFailure(error))
      }
    }}
  />
}

export function ValuationRoute() {
  const params = useLocalSearchParams<{ assetId?: string | string[] }>()
  const assetId = parseManualAssetId(params.assetId)
  const query = useManualAsset(assetId)
  const router = useRouter()
  const mutation = useRecordValuation()
  const [outcome, setOutcome] = useState<ManualAssetWriteFailure | null>(null)
  const back = () => (assetId === null ? router.replace('/assets' as Href) : router.replace(detailHref(assetId)))
  return <ValuationScreen
    assetName={query.data?.asset.name ?? null}
    currency={query.data?.asset.currency ?? null}
    pending={mutation.isPending}
    outcome={assetId === null ? 'not-found' : outcome}
    onBack={back}
    onSave={async (value) => {
      if (assetId === null) return
      setOutcome(null)
      try {
        await mutation.mutateAsync({ assetId, value })
        back()
      } catch (error) {
        setOutcome(classifyManualAssetWriteFailure(error))
      }
    }}
  />
}
