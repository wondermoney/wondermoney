import { useColorScheme } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { nativeIdentityProviders } from '@/lib/auth/native-identity-providers'
import { useConfirmedFeature } from '@/lib/server/use-instance'

import { SocialSignInButtons } from './social-sign-in-buttons'
import { useSocialSignIn } from './use-social-sign-in'

/**
 * Drop-in native sign-in block for the sign-in and sign-up routes.
 *
 * Renders nothing until at least one provider reports itself available, so Android —
 * where Sign in with Apple does not exist — simply gets the Google button, and a device
 * that supports neither gets no empty section.
 *
 * Google is offered only once the server reports `features.googleSignIn`: a self-hosted server
 * without Google OAuth credentials would reject the token exchange. Apple is not reported by the
 * server and is left to the device check.
 */
export function SocialSignIn({ onBeforeSignIn }: Readonly<{
  /**
   * Runs immediately before the native sheet opens, mirroring where the password paths
   * arm one-shot state (the sign-up route re-arms a pending household invite here, so
   * activation consumes it for a provider sign-up too).
   */
  onBeforeSignIn?: () => void
}> = {}) {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const { available, pending, failure, submit } = useSocialSignIn(nativeIdentityProviders)
  const googleSignIn = useConfirmedFeature((features) => features.googleSignIn)
  const providers = googleSignIn ? available : available.filter((provider) => provider !== 'google')

  return (
    <SocialSignInButtons
      failure={failure}
      onPress={(provider) => {
        onBeforeSignIn?.()
        void submit(provider)
      }}
      palette={themeTokens.colors[colorScheme]}
      pending={pending}
      providers={providers}
      scheme={colorScheme}
    />
  )
}
