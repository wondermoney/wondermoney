import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { usePortfolioDetail } from './use-portfolio-detail'
import { usePortfolios } from './use-portfolios'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 7, apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const list = { portfolios: [] }
const aggregate = { portfolios: [], summary: { assetCount: 0, currency: 'EUR', lastUpdated: '2026-07-19T10:00:00.000Z', periodLabel: 'YTD', periodReturn: 0, portfolioCount: 0, realizedGains: 0, totalGainLoss: 0, totalGainLossPercent: 0, totalValue: 0, unrealizedGains: 0 } }
const metadata = { portfolio: { currencyKey: { code: 'EUR' }, name: 'Broker', portfolioKey: 3 } }
const individual = { quickStats: { bestPerformer: null, biggestPosition: null, holdingsCount: 0, worstPerformer: null }, summary: { ...aggregate.summary, portfolioCount: undefined } }
delete (individual.summary as { portfolioCount?: number }).portfolioCount
const holdings = { holdings: [] }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('portfolio query hooks', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('loads aggregate data with exactly two reads and no automatic refetch behavior', async () => {
    mockRead.mockImplementation((endpoint) => Promise.resolve(endpoint.path === '/v1/portfolio' ? list : aggregate))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolios(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path).sort()).toEqual(['/v1/portfolio', '/v1/portfolio/dashboard?period=YTD'])
    for (const query of client.getQueryCache().getAll()) expect(query.options).toMatchObject({ refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity })
    await hook.rerender({})
    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('loads metadata before the two market-data detail reads and manual refresh makes three reads', async () => {
    let releaseMetadata!: () => void
    const metadataReady = new Promise<void>((resolve) => { releaseMetadata = resolve })
    mockRead.mockImplementation((endpoint) => endpoint.path.endsWith('/portfolio/3')
      ? metadataReady.then(() => metadata)
      : Promise.resolve(endpoint.path.endsWith('/dashboard?period=YTD') ? individual : holdings))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioDetail(3), { wrapper })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead.mock.calls[0]?.[0].path).toBe('/v1/portfolio/3')
    releaseMetadata()
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(3)
    await act(async () => { await hook.result.current.refetch() })
    expect(mockRead).toHaveBeenCalledTimes(6)
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('retries metadata and fetches gated dashboard and holdings after the initial metadata failure', async () => {
    mockRead.mockImplementationOnce(() => Promise.reject(new Error('metadata unavailable')))
    mockRead.mockImplementation((endpoint) => Promise.resolve(
      endpoint.path.endsWith('/dashboard?period=YTD') ? individual : endpoint.path.endsWith('/holdings') ? holdings : metadata,
    ))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioDetail(3), { wrapper })
    await waitFor(() => expect(hook.result.current.error).toBeTruthy())
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(mockRead).toHaveBeenCalledTimes(4)
    await hook.unmount()
    client.clear()
  })

  it('does not issue detail requests for an invalid id', async () => {
    const { client, wrapper } = setup()
    const hook = await renderHook(() => usePortfolioDetail(null), { wrapper })
    expect(hook.result.current.isInvalidId).toBe(true)
    expect(mockRead).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })
})
