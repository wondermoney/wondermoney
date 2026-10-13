import { createContext, type ReactNode, useContext, useMemo } from 'react'

import type { PasswordRecoveryAdapter } from '@/lib/auth/password-recovery'

const PasswordRecoveryContext = createContext<PasswordRecoveryAdapter | null>(null)

export function usePasswordRecovery(): PasswordRecoveryAdapter {
  const value = useContext(PasswordRecoveryContext)
  if (!value) throw new Error('usePasswordRecovery must be used within PasswordRecoveryProvider')
  return value
}

export type PasswordRecoveryProviderProps = Readonly<{
  adapter: PasswordRecoveryAdapter
  children: ReactNode
}>

export function PasswordRecoveryProvider({ adapter, children }: PasswordRecoveryProviderProps) {
  const value = useMemo(() => adapter, [adapter])
  return <PasswordRecoveryContext.Provider value={value}>{children}</PasswordRecoveryContext.Provider>
}
