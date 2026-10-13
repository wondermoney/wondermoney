import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { useProfile } from './use-self-resource'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
let mockEpochId = 7
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    runtime: { epochId: mockEpochId, apiClient: { read: mockRead, write: mockWrite } },
    blockAccess: mockBlockAccess,
  }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe.each([
  ['profile', useProfile, '/v1/user/me/profile', ['self', 'profile', 7], { profile: { emailAddress: 'a@b.com' } }],
] as const)('%s self query', (_label, useHook, path, key, value) => {
  beforeEach(() => {
    mockEpochId = 7
    mockRead.mockReset()
    mockWrite.mockReset()
    mockBlockAccess.mockReset()
  })

  it('loads through exact read policy without writes or persistence', async () => {
    mockRead.mockResolvedValue(value)
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHook(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path }))
    expect(client.getQueryData(key)).toEqual(value)
    expect(client.getQueryCache().find({ queryKey: key })?.options).toMatchObject({
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })
    expect(mockWrite).not.toHaveBeenCalled()
    await hook.unmount()
    client.clear()
  })

  it('retains valid same-epoch data for an ordinary refresh failure', async () => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError('network'))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHook(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.isRefreshFailure).toBe(true))
    expect(hook.result.current.data).toEqual(value)
    await hook.unmount()
    client.clear()
  })

  it.each([
    ['invalid-response', undefined],
    ['http', 404],
    ['mfa-required', undefined],
  ] as const)('suppresses cached data for %s', async (code, status) => {
    mockRead.mockResolvedValueOnce(value).mockRejectedValueOnce(new ApiError(code, status))
    const { client, wrapper } = setup()
    const hook = await renderHook(() => useHook(), { wrapper })
    await waitFor(() => expect(hook.result.current.data).toEqual(value))
    await act(async () => { await hook.result.current.refetch() })
    await waitFor(() => expect(hook.result.current.data).toBeUndefined())
    expect(hook.result.current.isAccessTransition).toBe(
      code === 'mfa-required',
    )
    expect(mockBlockAccess).toHaveBeenCalledTimes(
      code === 'mfa-required' ? 1 : 0,
    )
    await hook.unmount()
    client.clear()
  })
})
