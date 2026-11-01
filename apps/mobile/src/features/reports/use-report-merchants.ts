import { useQuery } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { transactionMerchantsEndpoint } from './report-merchants-contract'

const reportMerchantsKey = (epochId: number) => ['reports', epochId, 'merchants'] as const

export function useReportMerchants() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useReportMerchants requires an authenticated runtime')
  return useQuery({
    queryKey: reportMerchantsKey(runtime.epochId),
    queryFn: () => runtime.apiClient.read(transactionMerchantsEndpoint),
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
