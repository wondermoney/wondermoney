import * as Linking from 'expo-linking'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { AccessBlockedScreen } from '@/features/auth/access-blocked-screen'
import { useMfaChallenge } from '@/features/auth/use-mfa-challenge'
import { getRuntimeAppDisplayInfo } from '@/features/more/app-display-info'
import { buildSupportMailDestination, externalDestinations, isApprovedExternalDestination } from '@/features/more/link-policy'

const openApprovedExternal = async (destination: string) => {
  if (!isApprovedExternalDestination(destination)) throw new Error('Unapproved destination')
  await Linking.openURL(destination)
}

export default function AccessRoute() {
  const { routeState, signOut, retrySignOut } = useProductRuntime()
  const mfaChallenge = useMfaChallenge()
  if (
    routeState.status !== 'mfa-required'
    && routeState.status !== 'sign-out-failed'
  ) return null

  return (
    <AccessBlockedScreen
      status={routeState.status}
      onLogout={signOut}
      onRetrySignOut={retrySignOut}
      onOpenPrivacy={() => openApprovedExternal(externalDestinations.privacy)}
      onOpenTerms={() => openApprovedExternal(externalDestinations.terms)}
      onOpenSupport={async () => {
        const info = getRuntimeAppDisplayInfo()
        const destination = info ? buildSupportMailDestination(info) : null
        if (!destination) throw new Error('Support destination unavailable')
        await Linking.openURL(destination)
      }}
      mfaChallenge={{
        submitting: mfaChallenge.submitting,
        failure: mfaChallenge.failure,
        onSubmit: mfaChallenge.submit,
      }}
    />
  )
}
