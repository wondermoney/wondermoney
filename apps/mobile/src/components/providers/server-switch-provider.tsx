import { createContext, type ReactNode, useContext } from 'react'

export type ServerSwitch = Readonly<{
  /** The API the app currently talks to. */
  apiBaseUrl: string
  usesDefaultServer: boolean
  /** Saves `url` (or, with null, returns to the build's default server) and restarts the runtime on it. */
  switchServer: (url: string | null) => Promise<void>
}>

const ServerSwitchContext = createContext<ServerSwitch | null>(null)

export function ServerSwitchProvider({ children, value }: { children: ReactNode; value: ServerSwitch }) {
  return <ServerSwitchContext.Provider value={value}>{children}</ServerSwitchContext.Provider>
}

/** Null outside a live runtime (e.g. in isolated screen tests), where there is nothing to switch. */
export function useServerSwitch(): ServerSwitch | null {
  return useContext(ServerSwitchContext)
}
