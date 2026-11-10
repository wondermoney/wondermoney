import { createContext, useContext, type ReactNode } from 'react'
import { SafeAreaInsetsContext, SafeAreaView as NativeSafeAreaView, type Edge, type SafeAreaViewProps } from 'react-native-safe-area-context'

/**
 * The bottom safe-area inset, for something floating over a screen (the
 * floating action button). Reads the context directly so it is 0, not a
 * throw, where no provider is mounted (tests, previews).
 */
export function useBottomInset(): number {
  return useContext(SafeAreaInsetsContext)?.bottom ?? 0
}

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left']

/** True while the shell's top bar is on screen and owns the top safe area. */
const UnderTopBarContext = createContext(false)

export function UnderTopBarProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <UnderTopBarContext.Provider value={active}>{children}</UnderTopBarContext.Provider>
}

/**
 * The screen-level safe area. Under the shell's top bar it drops the top edge:
 * the bar already pads the notch, and a native SafeAreaView laid out before
 * the bar measures would otherwise add the full top inset again, leaving a
 * 60pt gap above the page title. On flow routes (no bar) it is the plain
 * SafeAreaView. Use this instead of importing react-native-safe-area-context.
 */
export function SafeAreaView({ edges, ...props }: SafeAreaViewProps) {
  const underTopBar = useContext(UnderTopBarContext)
  return <NativeSafeAreaView {...props} edges={underTopBar ? withoutTop(edges) : edges} />
}

function withoutTop(edges: SafeAreaViewProps['edges']): SafeAreaViewProps['edges'] {
  if (edges === undefined) return ALL_EDGES.filter((edge) => edge !== 'top')
  if (Array.isArray(edges)) return (edges as readonly Edge[]).filter((edge) => edge !== 'top')
  return { ...(edges as Record<Edge, unknown>), top: 'off' } as SafeAreaViewProps['edges']
}
