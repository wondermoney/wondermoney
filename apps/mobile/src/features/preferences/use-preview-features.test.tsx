import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { usePreviewFeatures } from './use-preview-features'

const mockRead = jest.fn()
const mockWrite = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: 9, apiClient: { read: mockRead, write: mockWrite } },
  }),
}))

const wrap = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  Wrapper.displayName = 'Wrapper'
  return Wrapper
}

describe('usePreviewFeatures', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockWrite.mockReset()
  })

  it('reads the stored flag for the current session', async () => {
    mockRead.mockResolvedValue({ previewFeatures: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })
    const hook = await renderHook(() => usePreviewFeatures(), { wrapper: wrap(client) })

    await waitFor(() => { expect(hook.result.current.enabled).toBe(true) })
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/user/me/preferences' }))
    await hook.unmount()
    client.clear()
  })

  it('reads as off while the preference is loading or unavailable', async () => {
    mockRead.mockRejectedValue(new Error('network'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } })
    const hook = await renderHook(() => usePreviewFeatures(), { wrapper: wrap(client) })

    expect(hook.result.current.enabled).toBe(false)
    await waitFor(() => { expect(hook.result.current.isLoadError).toBe(true) })
    expect(hook.result.current.enabled).toBe(false)
    await hook.unmount()
    client.clear()
  })

  it('patches the flag and commits the authoritative document into the epoch cache', async () => {
    mockRead.mockResolvedValue({ previewFeatures: false })
    mockWrite.mockImplementation(async (_endpoint, options) => {
      options.commit({ previewFeatures: true })
      return { previewFeatures: true }
    })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
    const hook = await renderHook(() => usePreviewFeatures(), { wrapper: wrap(client) })
    await waitFor(() => { expect(hook.result.current.isLoading).toBe(false) })

    await act(async () => { hook.result.current.setEnabled(true) })

    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/v1/user/me/preferences' }),
      expect.objectContaining({ body: { previewFeatures: true }, commit: expect.any(Function) }),
    )
    expect(client.getQueryData(['user-preferences', 9])).toEqual({ previewFeatures: true })
    await hook.unmount()
    client.clear()
  })
})
