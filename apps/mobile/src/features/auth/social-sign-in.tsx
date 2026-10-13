import { useColorScheme } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { nativeIdentityProviders } from '@/lib/auth/native-identity-providers'

import { SocialSignInButtons } from './social-sign-in-buttons'
import { useSocialSignIn, type SocialSignInFlow } from './use-social-sign-in'

/**
 * Drop-in native sign-in block for the sign-in and sign-up routes (RAD-420).
 *
 * Renders nothing until at least one provider reports itself available, so Android —
 * where Sign in with Apple does not exist — simply gets the Google button, and a device
 * that supports neither gets no empty section.
 */
export function SocialSignIn({ flow = 'sign_in', onBeforeSignIn }: Readonly<{
  /**
   * Which funnel this block was rendered in, so a completed provider exchange
   * reports `sign_up_completed` or `sign_in_completed` accordingly (RAD-518).
   */
  flow?: SocialSignInFlow
  /**
   * Runs immediately before the native sheet opens, mirroring where the password paths
   * arm one-shot state (the sign-up route re-arms a pending household invite here, so
   * activation consumes it for a provider sign-up too).
   */
  onBeforeSignIn?: () => void
}> = {}) {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const { available, pending, failure, submit } = useSocialSignIn(nativeIdentityProviders, flow)

  return (
    <SocialSignInButtons
      failure={failure}
      onPress={(provider) => {
        onBeforeSignIn?.()
        void submit(provider)
      }}
      palette={themeTokens.colors[colorScheme]}
      pending={pending}
      providers={available}
      scheme={colorScheme}
    />
  )
}
