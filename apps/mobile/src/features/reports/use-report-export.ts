import { useCallback, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'

import { shareReportCsv } from './report-csv-export'
import { createReportCsvEndpoint, type ReportFilters, type ReportSlug } from './reports-contract'

export type ReportExportState = Readonly<{ status: 'idle' | 'exporting' | 'error' }>

/** `today` (yyyy-MM-dd) is passed in by the caller rather than computed here — matches web's
 * `reports/<slug>-${format(new Date(), "yyyy-MM-dd")}` filename convention, kept as a plain
 * argument so this hook stays trivially testable without mocking the clock. */
export function useReportExport(slug: ReportSlug, filters: ReportFilters, today: string) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('useReportExport requires an authenticated runtime')
  const [state, setState] = useState<ReportExportState>({ status: 'idle' })

  const exportCsv = useCallback(async () => {
    setState({ status: 'exporting' })
    try {
      const csv = await runtime.apiClient.readRaw(createReportCsvEndpoint(slug, filters))
      await shareReportCsv(csv, `${slug}-${today}.csv`)
      setState({ status: 'idle' })
    } catch {
      setState({ status: 'error' })
    }
  }, [runtime, slug, filters, today])

  return { state, exportCsv }
}
