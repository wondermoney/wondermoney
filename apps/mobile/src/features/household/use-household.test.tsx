import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useHousehold } from './use-household'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockRuntime: { epochId: number; apiClient: { read: typeof mockRead; write: typeof mockWrite } } | null
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: mockRuntime, blockAccess: mockBlockAccess }),
}))

const value = { members: [], pendingInvite: null }
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useHousehold', () => {
  beforeEach(() => {
    mockRuntime = { epochId: 7, apiClient: { read: mockRead, write: mockWrite } }
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through the exact read endpoint, epoch key, and never writes', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/household' }))
    expect(client.getQueryData(['household', 7])).toEqual(value)
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it.each(['invalid-response', 'mfa-required'] as const)('synchronously suppresses stale data for %s', async (code) => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(hook.result.current.isInitialFailure).toBe(true)
    expect(hook.result.current.isAccessTransition).toBe(code !== 'invalid-response')
    if (code !== 'invalid-response') expect(mockBlockAccess).toHaveBeenCalledTimes(1)
    await hook.unmount()
    client.clear()
  })

  it('isolates data when the epoch changes', async () => {
    mockRead.mockResolvedValueOnce({ members: [{ appuserKey: 1, emailAddress: 'a@b.co', role: 'owner' }], pendingInvite: null }).mockResolvedValueOnce(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(hook.result.current.data?.members).toHaveLength(1))
    mockRuntime = { ...mockRuntime!, epochId: 8 }
    await hook.rerender({})
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(client.getQueryData(['household', 7])).not.toEqual(value)
    expect(client.getQueryData(['household', 8])).toEqual(value)
    await hook.unmount()
    client.clear()
  })
})
