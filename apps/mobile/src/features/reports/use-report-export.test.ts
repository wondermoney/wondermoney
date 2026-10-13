import { act, renderHook } from '@testing-library/react-native'

import { useReportExport } from './use-report-export'

const mockReadRaw = jest.fn()
const mockUseProductRuntime = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => mockUseProductRuntime() }))

const mockShareReportCsv = jest.fn()
jest.mock('./report-csv-export', () => ({ shareReportCsv: (...args: unknown[]) => mockShareReportCsv(...args) }))

const filters = { fromDate: '2026-05-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }

describe('useReportExport', () => {
  beforeEach(() => {
    mockReadRaw.mockReset().mockResolvedValue('month,net\n2026-08,500')
    mockShareReportCsv.mockReset().mockResolvedValue(undefined)
    mockUseProductRuntime.mockReturnValue({ runtime: { apiClient: { readRaw: mockReadRaw } } })
  })

  it('starts idle', async () => {
    const hook = await renderHook(() => useReportExport('cashflow', filters, '2026-08-11'))
    expect(hook.result.current.state).toEqual({ status: 'idle' })
  })

  it('fetches the CSV via readRaw and shares it, ending idle again on success', async () => {
    const hook = await renderHook(() => useReportExport('cashflow', filters, '2026-08-11'))
    await act(async () => { await hook.result.current.exportCsv() })
    expect(mockReadRaw).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: expect.stringContaining('/v1/reports/cashflow.csv?') }))
    expect(mockShareReportCsv).toHaveBeenCalledWith('month,net\n2026-08,500', 'cashflow-2026-08-11.csv')
    expect(hook.result.current.state).toEqual({ status: 'idle' })
  })

  it('surfaces an error state without throwing when the fetch fails', async () => {
    mockReadRaw.mockRejectedValue(new Error('network'))
    const hook = await renderHook(() => useReportExport('sankey', filters, '2026-08-11'))
    await act(async () => { await hook.result.current.exportCsv() })
    expect(hook.result.current.state).toEqual({ status: 'error' })
    expect(mockShareReportCsv).not.toHaveBeenCalled()
  })

  it('surfaces an error state when sharing fails after a successful fetch', async () => {
    mockShareReportCsv.mockRejectedValue(new Error('share unavailable'))
    const hook = await renderHook(() => useReportExport('budget-vs-actual', filters, '2026-08-11'))
    await act(async () => { await hook.result.current.exportCsv() })
    expect(hook.result.current.state).toEqual({ status: 'error' })
  })
})
