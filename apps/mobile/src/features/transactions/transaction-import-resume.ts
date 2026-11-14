import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'

/**
 * The staged import the person left unfinished on this device, so the import screen resumes it
 * when they return. The API keeps no list of a person's open sessions, so the app keeps the id
 * (and when the session expires, to tell an expired one from one that is just gone). A session id
 * is no secret: the API serves it only to the person who started it. Kept in SecureStore because
 * it is the one key-value store this app wires up.
 */
const KEY = 'wondermoney.transaction-import.pending'

export type PendingTransactionImport = Readonly<{ sessionId: string; expiresAt: string | null }>

export type PendingTransactionImportStorage = Readonly<{
  /** The pending import of this person, or `null` (none, another person's, unreadable or storage failed). */
  load: (principalId: string) => Promise<PendingTransactionImport | null>
  save: (principalId: string, pending: PendingTransactionImport) => Promise<void>
  clear: () => Promise<void>
}>

function parse(raw: string | null, principalId: string): PendingTransactionImport | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const { principalId: owner, sessionId, expiresAt } = value as Record<string, unknown>
    if (owner !== principalId || typeof sessionId !== 'string' || !sessionId) return null
    return { sessionId, expiresAt: typeof expiresAt === 'string' ? expiresAt : null }
  } catch {
    return null
  }
}

export const secureStorePendingTransactionImport: PendingTransactionImportStorage = {
  load: async (principalId) => {
    try {
      return parse(await SecureStore.getItemAsync(KEY), principalId)
    } catch {
      return null
    }
  },
  save: async (principalId, pending) => {
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify({ principalId, ...pending }))
    } catch {
      // Without storage the import still reviews now; it just won't resume later.
    }
  },
  clear: async () => {
    try {
      await SecureStore.deleteItemAsync(KEY)
    } catch {
      // A stale id resumes into "not found" and is cleared again then.
    }
  },
}

/**
 * Reads the pending import once for `principalId`; `checking` until it has. `remember` keeps a
 * staged session, `forget` drops it (an outcome seen, a cancel, a fresh start).
 */
export function useTransactionImportResume(principalId: string | null, storage: PendingTransactionImportStorage = secureStorePendingTransactionImport) {
  const [loaded, setLoaded] = useState<Readonly<{ principalId: string; pending: PendingTransactionImport | null }> | null>(null)

  useEffect(() => {
    if (principalId === null) return
    let active = true
    void storage.load(principalId).then((found) => {
      if (active) setLoaded({ principalId, pending: found })
    })
    return () => { active = false }
  }, [principalId, storage])

  const checking = principalId !== null && loaded?.principalId !== principalId
  const pending = !checking && loaded ? loaded.pending : null

  const remember = useCallback(async (session: Readonly<{ id: string; expiresAt: string }>) => {
    if (principalId === null) return
    const next = { sessionId: session.id, expiresAt: session.expiresAt }
    setLoaded({ principalId, pending: next })
    await storage.save(principalId, next)
  }, [principalId, storage])

  const forget = useCallback(async () => {
    setLoaded((current) => (current ? { ...current, pending: null } : current))
    await storage.clear()
  }, [storage])

  return { checking, pending, remember, forget }
}
