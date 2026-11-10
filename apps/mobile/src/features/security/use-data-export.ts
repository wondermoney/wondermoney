import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { type DataExport, listDataExportsEndpoint, startDataExportBody, startDataExportEndpoint } from './data-export-contract'
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

export type DataExportFailure = 'limit' | 'in-progress' | 'password' | 'unknown'

/**
 * Why starting an export failed, from the status the API answered with: 429 is the daily limit,
 * 409 another export of the other kind (protected or not) still running, and 400 a password the
 * server rejected (its message is never shown: it is in English and the request log's wording).
 */
export function classifyDataExportFailure(error: unknown): DataExportFailure {
  if (!(error instanceof ApiError) || error.code !== 'http') return 'unknown'
  if (error.status === 429) return 'limit'
  if (error.status === 409) return 'in-progress'
  if (error.status === 400) return 'password'
  return 'unknown'
}

/**
 * Start an export, or get back the one already in progress. Never replayed automatically. With a
 * password the server encrypts the archive with it; it goes in the request body only.
 */
export function useStartDataExport() {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useStartDataExport requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    mutationFn: async (options: { password?: string } = {}) => (
      await runtime.apiClient.write(startDataExportEndpoint, { body: startDataExportBody(options.password), commit: () => undefined })
    ).export,
    onSuccess: (dataExport) => {
      queryClient.setQueryData<DataExport[]>(dataExportsKey(runtime.epochId), (current) => [
        dataExport,
        ...(current ?? []).filter((item) => item.id !== dataExport.id),
      ])
    },
  })
}
