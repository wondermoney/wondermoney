import type { ReactNode } from 'react'

import { SessionPreferencesProvider } from '@/components/providers/session-preferences-provider'
import type { PreferenceStorage } from '@/features/preferences/preference-storage'

/** A preference store that starts with privacy mode as given and records saves. */
export function memoryPreferenceStorage(privacyMode: boolean | null): PreferenceStorage & { saved: boolean[] } {
  const saved: boolean[] = []
  return {
    saved,
    load: async () => ({ theme: null, language: null, privacyMode }),
    saveTheme: async () => undefined,
    saveLanguage: async () => undefined,
    savePrivacyMode: async (value) => {
      saved.push(value)
    },
  }
}

/**
 * The real preferences provider over an in-memory store. Privacy mode arrives
 * from the store asynchronously, as on device, so assert with `findBy*`.
 */
export function PrivacyModeProvider({ children, hidden = true, storage }: { children: ReactNode; hidden?: boolean; storage?: PreferenceStorage }) {
  return (
    <SessionPreferencesProvider
      appearance={{ setColorScheme: () => undefined }}
      deviceLocale="en"
      deviceTheme="light"
      storage={storage ?? memoryPreferenceStorage(hidden)}
    >
      {children}
    </SessionPreferencesProvider>
  )
}

type RenderedNode = { props?: Record<string, unknown>; children?: unknown[] | null } | string | null

/**
 * Every string a person could see or hear in a rendered tree: text children
 * and string props (accessibility labels and the like), joined by newlines.
 */
export function renderedText(node: RenderedNode | RenderedNode[]): string {
  if (node === null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(renderedText).join('\n')
  const props = Object.values(node.props ?? {}).filter((value): value is string => typeof value === 'string')
  return [...props, ...(node.children ?? []).map((child) => renderedText(child as RenderedNode))].join('\n')
}
