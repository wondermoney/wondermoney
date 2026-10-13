import { act, renderHook } from '@testing-library/react-native'

import { useReportFilters } from './use-report-filters'

describe('useReportFilters', () => {
  it('starts with no active filters and the default date preset', async () => {
    const hook = await renderHook(() => useReportFilters())
    expect(hook.result.current.preset).toBe('last3Months')
    expect(hook.result.current.activeFilterCount).toBe(0)
    expect(hook.result.current.filters.accountKeys).toEqual([])
  })

  it('updates each field independently and reflects it in the derived filters and count', async () => {
    const hook = await renderHook(() => useReportFilters())
    await act(async () => hook.result.current.setAccountKeys(['1', '2']))
    await act(async () => hook.result.current.setCurrencyKey('EUR'))
    await act(async () => hook.result.current.setIncludePending(true))
    expect(hook.result.current.filters.accountKeys).toEqual(['1', '2'])
    expect(hook.result.current.filters.currencyKey).toBe('EUR')
    expect(hook.result.current.filters.includePending).toBe(true)
    expect(hook.result.current.activeFilterCount).toBe(3)
  })

  it('resets all fields back to empty without touching the date preset', async () => {
    const hook = await renderHook(() => useReportFilters())
    await act(async () => hook.result.current.selectPreset('allTime'))
    await act(async () => hook.result.current.setCategoryKeys(['9']))
    await act(async () => hook.result.current.setIncludeTransfers(true))
    await act(async () => hook.result.current.resetFields())
    expect(hook.result.current.activeFilterCount).toBe(0)
    expect(hook.result.current.filters.categoryKeys).toEqual([])
    expect(hook.result.current.preset).toBe('allTime')
  })
})
