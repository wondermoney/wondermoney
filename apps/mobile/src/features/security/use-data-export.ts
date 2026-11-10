import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { type DataExport, listDataExportsEndpoint, startDataExportEndpoint } from './data-export-contract'
import { dataExportsKey } from './query-keys'

const POLL_INTERVAL_MS = 3000

/** Whether the server is still preparing a stored export, so its status is worth polling. */
export function isDataExportPreparing(dataExport: DataExport | null | undefined): boolean {
  return dataExport?.delivery === 'storage' && (dataExport.status === 'queued' || dataExport.status === 'running')
}

/** The member's most recent export of the last 24 hours, polled while it is being prepared. */
export function useLatestDataExport(enabled: boolean) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useLatestDataExport requires an authenticated runtime')

  return useQuery({
    enabled,
    queryKey: dataExportsKey(runtime.epochId),
    queryFn: async () => (await runtime.apiClient.read(listDataExportsEndpoint)).exports,
    select: (exports): DataExport | null => exports[0] ?? null,
    refetchInterval: (query) => (isDataExportPreparing(query.state.data?.[0]) ? POLL_INTERVAL_MS : false),
  })
}

/** Start an export, or get back the one already in progress. Never replayed automatically. */
export function useStartDataExport() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useStartDataExport requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    mutationFn: async () => (await runtime.apiClient.write(startDataExportEndpoint, { body: {}, commit: () => undefined })).export,
    onSuccess: (dataExport) => {
      queryClient.setQueryData<DataExport[]>(dataExportsKey(runtime.epochId), (current) => [
        dataExport,
        ...(current ?? []).filter((item) => item.id !== dataExport.id),
      ])
    },
  })
}
