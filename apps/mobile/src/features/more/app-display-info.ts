import Constants from 'expo-constants'

import type { AppDisplayInfo } from './link-policy'

type DisplayInput = Readonly<{
  version: unknown
  environment: unknown
}>

const approvedVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function getAppDisplayInfo(input: DisplayInput): AppDisplayInfo | null {
  if (typeof input.version !== 'string' || !approvedVersion.test(input.version)) return null
  if (input.environment !== 'local' && input.environment !== 'staging') return null
  return { version: input.version, environment: input.environment }
}

export function getRuntimeAppDisplayInfo(): AppDisplayInfo | null {
  return getAppDisplayInfo({
    version: Constants.expoConfig?.version,
    environment: process.env.EXPO_PUBLIC_APP_ENV,
  })
}
