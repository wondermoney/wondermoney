import { renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import type { PasswordRecoveryAdapter } from '@/lib/auth/password-recovery'

import { PasswordRecoveryProvider, usePasswordRecovery } from './password-recovery-provider'

const adapter: PasswordRecoveryAdapter = {
  requestReset: jest.fn(),
  confirmReset: jest.fn(),
  clearCachedIdentity: jest.fn(),
}

describe('PasswordRecoveryProvider', () => {
  it('throws when used outside the provider', async () => {
    const hook = await renderHook(() => {
      try {
        return usePasswordRecovery()
      } catch (error) {
        return error
      }
    })
    expect(hook.result.current).toBeInstanceOf(Error)
  })

  it('exposes the adapter passed to it', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PasswordRecoveryProvider adapter={adapter}>{children}</PasswordRecoveryProvider>
    )
    const hook = await renderHook(() => usePasswordRecovery(), { wrapper })
    expect(hook.result.current).toBe(adapter)
  })
})
