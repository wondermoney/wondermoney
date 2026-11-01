import { useCallback, useMemo, useState } from 'react'

import { DEFAULT_REPORT_DATE_PRESET, type ReportDatePreset, reportPresetDateRange } from './report-date-presets'
import type { ReportFilters } from './reports-contract'

export type ReportFilterFields = Readonly<{
  accountKeys: readonly string[]
  categoryKeys: readonly string[]
  merchantKeys: readonly string[]
  currencyKey: string | undefined
  includePending: boolean
  includeTransfers: boolean
}>

const EMPTY_FIELDS: ReportFilterFields = {
  accountKeys: [], categoryKeys: [], merchantKeys: [], currencyKey: undefined, includePending: false, includeTransfers: false,
}

/**
 * Mobile-local equivalent of web's URL-persisted useReportFilters — mobile routes
 * aren't a shareable/bookmarkable surface the same way, so filter state lives in the screen
 * instead of the URL.
 */
export function useReportFilters(initialPreset: ReportDatePreset = DEFAULT_REPORT_DATE_PRESET) {
  const [preset, setPreset] = useState<ReportDatePreset>(initialPreset)
  const [fields, setFields] = useState<ReportFilterFields>(EMPTY_FIELDS)

  const filters = useMemo<ReportFilters>(() => {
    const range = reportPresetDateRange(preset)
    return {
      fromDate: range.from.toISOString(),
      toDate: range.to.toISOString(),
      accountKeys: fields.accountKeys,
      categoryKeys: fields.categoryKeys,
      merchantKeys: fields.merchantKeys,
      currencyKey: fields.currencyKey,
      includePending: fields.includePending,
      includeTransfers: fields.includeTransfers,
    }
  }, [preset, fields])

  const activeFilterCount = useMemo(() => (
    (fields.accountKeys.length > 0 ? 1 : 0)
    + (fields.categoryKeys.length > 0 ? 1 : 0)
    + (fields.merchantKeys.length > 0 ? 1 : 0)
    + (fields.currencyKey ? 1 : 0)
    + (fields.includePending ? 1 : 0)
    + (fields.includeTransfers ? 1 : 0)
  ), [fields])

  const selectPreset = useCallback((next: ReportDatePreset) => setPreset(next), [])
  const setAccountKeys = useCallback((accountKeys: readonly string[]) => setFields((prev) => ({ ...prev, accountKeys })), [])
  const setCategoryKeys = useCallback((categoryKeys: readonly string[]) => setFields((prev) => ({ ...prev, categoryKeys })), [])
  const setMerchantKeys = useCallback((merchantKeys: readonly string[]) => setFields((prev) => ({ ...prev, merchantKeys })), [])
  const setCurrencyKey = useCallback((currencyKey: string | undefined) => setFields((prev) => ({ ...prev, currencyKey })), [])
  const setIncludePending = useCallback((includePending: boolean) => setFields((prev) => ({ ...prev, includePending })), [])
  const setIncludeTransfers = useCallback((includeTransfers: boolean) => setFields((prev) => ({ ...prev, includeTransfers })), [])
  const resetFields = useCallback(() => setFields(EMPTY_FIELDS), [])

  return {
    preset, filters, fields, activeFilterCount,
    selectPreset, setAccountKeys, setCategoryKeys, setMerchantKeys, setCurrencyKey, setIncludePending, setIncludeTransfers, resetFields,
  }
}
