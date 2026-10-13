import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import {
  createTransactionMerchantsEndpoint,
  settlementCurrenciesEndpoint,
  transactionTypesEndpoint,
} from './manual-transaction-contract'

export const transactionTypesKey = (epochId: number) => ['transaction-create', epochId, 'types'] as const
export const settlementCurrenciesKey = (epochId: number) => ['transaction-create', epochId, 'currencies'] as const
export const transactionMerchantsKey = (epochId: number, search: string) => ['transaction-create', epochId, 'merchants', search.trim(), 20] as const

const queryOptions = { retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false } as const

export function useManualTransactionMetadata(merchantSearch: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useManualTransactionMetadata requires an authenticated runtime')
  const search = merchantSearch.trim().slice(0, 200)
  return {
    types: useQuery({ queryKey: transactionTypesKey(runtime.epochId), queryFn: () => runtime.apiClient.read(transactionTypesEndpoint), ...queryOptions }),
    currencies: useQuery({ queryKey: settlementCurrenciesKey(runtime.epochId), queryFn: () => runtime.apiClient.read(settlementCurrenciesEndpoint), ...queryOptions }),
    merchants: useQuery({ queryKey: transactionMerchantsKey(runtime.epochId, search), queryFn: () => runtime.apiClient.read(createTransactionMerchantsEndpoint(search)), ...queryOptions }),
  }
}
