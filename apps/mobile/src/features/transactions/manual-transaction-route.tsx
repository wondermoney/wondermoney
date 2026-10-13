import { useQueryClient } from '@tanstack/react-query'
import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { parseAccountId } from '@/features/accounts/accounts-contract'
import { mapAccounts } from '@/features/accounts/accounts-view-model'
import { useAccounts } from '@/features/accounts/use-accounts'
import { mapCategories } from '@/features/categories/categories-view-model'
import { useCategories } from '@/features/categories/use-categories'
import { ApiError } from '@/lib/api/errors'

import type { FrozenManualTransaction } from './manual-transaction-contract'
import { ManualTransactionScreen } from './manual-transaction-screen'
import { classifyManualTransactionFailure, isManualTransactionAffectedQuery, type ManualTransactionFailure, useCreateManualTransaction } from './use-create-manual-transaction'
import { useManualTransactionMetadata } from './use-manual-transaction-metadata'

export const resolveMerchantSearchStatus = ({ isError, isFetching }: { isError: boolean; isFetching: boolean }): 'loading' | 'error' | 'loaded' => (
  isError ? 'error' : isFetching ? 'loading' : 'loaded'
)

export function ManualTransactionRoute() {
  const params = useLocalSearchParams<{ accountId?: string | string[] }>()
  const initialAccountId = parseAccountId(params.accountId)
  const accounts = useAccounts()
  const categories = useCategories()
  const [merchantSearch, setMerchantSearch] = useState('')
  const metadata = useManualTransactionMetadata(merchantSearch)
  const mutation = useCreateManualTransaction()
  const { runtime, blockAccess } = useProductRuntime()
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<ManualTransactionFailure | null>(null)
  const router = useRouter()
  const navigation = useNavigation()
  const { t, i18n } = useTranslation()

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (mutation.isPending) event.preventDefault()
  }), [mutation.isPending, navigation])

  useEffect(() => {
    const errors = [metadata.types.error, metadata.currencies.error, metadata.merchants.error]
    if (errors.some((error) => error instanceof ApiError && error.code === 'mfa-required')) blockAccess('mfa-required')
  }, [blockAccess, metadata.currencies.error, metadata.merchants.error, metadata.types.error])

  const inspect = (frozen: FrozenManualTransaction, refresh: boolean) => {
    if (refresh && runtime) void queryClient.invalidateQueries({ predicate: (query) => isManualTransactionAffectedQuery(query.queryKey, runtime.epochId) })
    router.replace({
      pathname: '/accounts/[accountId]/transactions',
      params: { accountId: String(frozen.accountId) },
    } as Href)
  }

  const loading = accounts.isLoading || categories.isLoading || metadata.types.isLoading || metadata.currencies.isLoading
  const metadataError = accounts.isError || categories.isError || metadata.types.isError || metadata.currencies.isError
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  return <ManualTransactionScreen
    accounts={accounts.data ? mapAccounts(accounts.data) : []}
    categories={categories.data ? mapCategories(categories.data, t, locale) : []}
    types={metadata.types.data?.transactionTypes ?? []}
    currencies={metadata.currencies.data?.currencies ?? []}
    merchants={metadata.merchants.data?.transactionMerchants ?? []}
    merchantSearchStatus={resolveMerchantSearchStatus(metadata.merchants)}
    initialAccountId={initialAccountId}
    loading={loading}
    metadataError={metadataError}
    pending={mutation.isPending}
    outcome={outcome}
    onMerchantSearch={setMerchantSearch}
    onEdit={() => setOutcome(null)}
    onBack={() => initialAccountId ? router.replace(`/accounts/${initialAccountId}/transactions` as Href) : router.replace('/accounts/transactions')}
    onInspect={(frozen) => inspect(frozen, true)}
    onSubmit={async (frozen) => {
      setOutcome(null)
      try {
        await mutation.mutateAsync(frozen)
        inspect(frozen, false)
      } catch (error) {
        const result = classifyManualTransactionFailure(error)
        setOutcome(result)
        if (error instanceof ApiError && (error.code === 'mfa-required')) return
      }
    }}
  />
}
