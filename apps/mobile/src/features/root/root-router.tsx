import { Stack } from 'expo-router'

import { AuthenticatedRouteBoundary } from '@/components/providers/authenticated-route-boundary'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useInviteDeepLink } from '@/features/auth/use-invite-deep-link'
import { useRecoveryDeepLink } from '@/features/auth/use-recovery-deep-link'
import { useFeatureScreenAnalytics } from '@/features/navigation/screen-analytics'

export function RootRouter() {
  useRecoveryDeepLink()
  useInviteDeepLink()
  // RAD-518 — mounted here, above every guard, so the signed-out and
  // authenticated trees share one screen-view observer. The gates below
  // `(app)` render null while they resolve, which would silently drop views
  // for any observer placed under them.
  useFeatureScreenAnalytics()
  const { routeState } = useProductRuntime()
  const signedOut = routeState.status === 'signed-out'
  const financial = routeState.status === 'authenticated' || routeState.status === 'deactivating'
  const access = routeState.status === 'mfa-required'
    || routeState.status === 'sign-out-failed'

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      <Stack.Protected guard={financial}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={access}>
        <Stack.Screen name="access" />
      </Stack.Protected>
    </Stack>
  )
}

export { AuthenticatedRouteBoundary }
