import * as LocalAuthentication from 'expo-local-authentication'

export type LocalAuthCapability = 'available' | 'no-hardware' | 'not-enrolled'

export async function checkLocalAuthCapability(): Promise<LocalAuthCapability> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return 'no-hardware'
    if (!(await LocalAuthentication.isEnrolledAsync())) return 'not-enrolled'
    return 'available'
  } catch {
    return 'no-hardware'
  }
}

/** Device-passcode fallback is left enabled (the default) — a user who unenrolls biometrics but
 * keeps a device passcode should still be able to get back into the app. */
export async function authenticateWithDeviceAsync(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage })
    return result.success
  } catch {
    return false
  }
}
