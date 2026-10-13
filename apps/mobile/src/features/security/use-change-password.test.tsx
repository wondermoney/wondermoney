import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useChangePassword } from './use-change-password'

const mockChangePassword = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ changePassword: mockChangePassword }),
}))

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

describe('useChangePassword', () => {
  beforeEach(() => { mockChangePassword.mockReset() })

  it('forwards the payload to the runtime and resolves with the outcome', async () => {
    mockChangePassword.mockResolvedValue({ status: 'updated' })
    const { wrapper } = setup()
    const hook = await renderHook(() => useChangePassword(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync({
        email: 'person@example.com',
        currentPassword: 'oldpw12345',
        newPassword: 'newpw12345',
      })).resolves.toEqual({ status: 'updated' })
    })

    expect(mockChangePassword).toHaveBeenCalledWith('person@example.com', 'oldpw12345', 'newpw12345')
    await hook.unmount()
  })

  it('surfaces an invalid-current-password outcome without throwing', async () => {
    mockChangePassword.mockResolvedValue({ status: 'invalid-current-password' })
    const { wrapper } = setup()
    const hook = await renderHook(() => useChangePassword(), { wrapper })

    await act(async () => {
      await expect(hook.result.current.mutateAsync({
        email: 'person@example.com',
        currentPassword: 'wrong',
        newPassword: 'newpw12345',
      })).resolves.toEqual({ status: 'invalid-current-password' })
    })
    await hook.unmount()
  })
})
