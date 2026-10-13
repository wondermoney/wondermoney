import { createContext, type ReactNode, useContext } from 'react'

export type AppSessionValue<Session> = Readonly<{ session: Session | null }>

const AppSessionContext = createContext<AppSessionValue<unknown> | null>(null)

export function AppSessionProvider<Session>({
  session,
  children,
}: AppSessionValue<Session> & { children: ReactNode }) {
  return (
    <AppSessionContext.Provider value={{ session }}>
      {children}
    </AppSessionContext.Provider>
  )
}

export function useAppSession<Session = unknown>(): AppSessionValue<Session> {
  const value = useContext(AppSessionContext)
  if (!value) throw new Error('useAppSession must be used within AppProviders')
  return value as AppSessionValue<Session>
}
