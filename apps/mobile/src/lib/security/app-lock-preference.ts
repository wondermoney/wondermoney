import * as SecureStore from 'expo-secure-store'

/**
 * A plain (non-secret) on/off flag, not the app-lock gate itself — persisted via SecureStore
 * only because it's already the one storage mechanism wired into this app (see
 * secure-session-storage.ts), not because this value needs encryption at rest.
 */
const APP_LOCK_PREFERENCE_KEY = 'wondermoney.app-lock-enabled'

export async function getAppLockPreference(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(APP_LOCK_PREFERENCE_KEY)) === 'true'
  } catch {
    return false
  }
}

export async function setAppLockPreference(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(APP_LOCK_PREFERENCE_KEY, enabled ? 'true' : 'false')
}
