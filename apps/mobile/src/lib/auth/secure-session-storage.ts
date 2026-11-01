import type { KeychainAccessibilityConstant, SecureStoreOptions } from 'expo-secure-store'

type SecureStorePort = {
  readonly WHEN_UNLOCKED_THIS_DEVICE_ONLY: KeychainAccessibilityConstant
  getItemAsync: (key: string, options: SecureStoreOptions) => Promise<unknown>
  setItemAsync: (key: string, value: string, options: SecureStoreOptions) => Promise<void>
  deleteItemAsync: (key: string, options: SecureStoreOptions) => Promise<void>
}

/**
 * The synchronous half of `expo-secure-store`, used only by the better-auth Expo
 * storage adapter. Both calls are hardened with the same options as the async
 * half, so a synchronous read cannot return a value the app did not ask to store.
 */
type SecureStoreSyncPort = {
  getItem: (key: string, options: SecureStoreOptions) => string | null
  setItem: (key: string, value: string, options: SecureStoreOptions) => void
}

/**
 * Vendor-neutral async key/value storage contract. It is the seam the
 * application persists session material through; keeping it declared here
 * (rather than importing a vendor type) keeps the storage layer free of SDK
 * coupling.
 */
export type SessionStoragePort = Readonly<{
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}>

/**
 * The storage contract `@better-auth/expo`'s client consumes: both async and
 * synchronous accessors. The synchronous pair is only reached by better-auth's
 * synchronous write path (and its chunk cleanup); it must never be allowed to
 * fall back to insecure, non-keychain storage.
 */
export type BetterAuthExpoStorage = Readonly<{
  getItem: (key: string) => string | null
  getItemAsync: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => void
  setItemAsync: (key: string, value: string) => Promise<void>
}>

type StorageOperation = 'read' | 'write' | 'delete'

/**
 * How a storage failure should be treated by the caller:
 *
 * - `recoverable` — the operation could not read the keychain. The honest
 *   interpretation is "no persisted session is readable right now", never "the
 *   user is signed out" and never a plaintext fallback. The session lifecycle
 *   surfaces this as a recoverable bootstrap error and keeps the session.
 * - `destructive` — a write or delete did not complete. The caller must not
 *   assume material was persisted or removed; treating this as success would
 *   silently strand or retain credentials.
 */
export type StorageFailureKind = 'recoverable' | 'destructive'

class SecureSessionStorageError extends Error {
  override name = 'SecureSessionStorageError'

  constructor(readonly operation: StorageOperation) {
    super('Secure session storage operation failed')
  }

  get failure(): StorageFailureKind {
    return this.operation === 'read' ? 'recoverable' : 'destructive'
  }
}

const storageOptions = (store: Pick<SecureStorePort, 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'>): SecureStoreOptions => ({
  keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  // The app never gates session material behind a biometric prompt: the app-lock
  // flow owns that UX separately, and a prompt here would make background
  // refresh silently fail.
  requireAuthentication: false,
})

/**
 * Wraps the async half of `expo-secure-store` as the application's session
 * storage. No operation falls back to another store: a read failure is reported
 * as a recoverable error, and a write/delete failure as a destructive one.
 */
export const createSecureSessionStorage = (
  store: SecureStorePort,
) => {
  const options = storageOptions(store)

  const storage = {
    async getItem(key: string) {
      let value: unknown

      try {
        value = await store.getItemAsync(key, options)
      } catch {
        throw new SecureSessionStorageError('read')
      }

      if (value === null || typeof value === 'string') {
        return value
      }

      throw new SecureSessionStorageError('read')
    },

    async setItem(key: string, value: string) {
      try {
        await store.setItemAsync(key, value, options)
      } catch {
        throw new SecureSessionStorageError('write')
      }
    },

    async removeItem(key: string) {
      try {
        await store.deleteItemAsync(key, options)
      } catch {
        throw new SecureSessionStorageError('delete')
      }
    },
  } satisfies SessionStoragePort

  return storage
}

/**
 * Adapts the hardened secure session storage to the shape `@better-auth/expo`
 * requires. The async accessors reuse `createSecureSessionStorage` (so the
 * keychain options and error taxonomy are identical); the synchronous accessors
 * use the native synchronous keychain API with the same options and fail closed
 * with a typed error instead of returning unauthenticated data.
 */
export const createBetterAuthExpoStorage = (
  store: SecureStorePort & SecureStoreSyncPort,
): BetterAuthExpoStorage => {
  const sessionStorage = createSecureSessionStorage(store)
  const options = storageOptions(store)

  return {
    getItemAsync: (key) => sessionStorage.getItem(key),
    setItemAsync: (key, value) => sessionStorage.setItem(key, value),
    getItem: (key) => {
      try {
        const value = store.getItem(key, options)
        return value === null || typeof value === 'string' ? value : null
      } catch {
        throw new SecureSessionStorageError('read')
      }
    },
    setItem: (key, value) => {
      try {
        store.setItem(key, value, options)
      } catch {
        throw new SecureSessionStorageError('write')
      }
    },
  }
}
