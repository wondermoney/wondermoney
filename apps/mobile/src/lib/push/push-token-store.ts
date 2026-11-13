import * as SecureStore from 'expo-secure-store'

export type PushTokenStore = Readonly<{
  load: () => Promise<string | null>
  save: (token: string) => Promise<void>
  clear: () => Promise<void>
}>

const TOKEN_KEY = 'wondermoney.push-token'

/** The token this phone last registered, so signing out can remove it from the server. */
export const securePushTokenStore: PushTokenStore = {
  load: async () => {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY)
    } catch {
      return null
    }
  },
  save: async (token) => {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token)
    } catch {
      // Without it, sign-out cannot name the token; the server still drops it with the session.
    }
  },
  clear: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
    } catch {
      // Nothing to do.
    }
  },
}
