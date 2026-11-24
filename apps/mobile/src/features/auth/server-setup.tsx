import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useServerSwitch } from '@/components/providers/server-switch-provider'
import { Text } from '@/components/ui/text'
import { instanceQueryKey, usePasswordSignIn } from '@/lib/server/use-instance'

import { ServerSwitcher } from './server-switcher'
import { SignUpScreen } from './sign-up-screen'
import { SocialSignIn } from './social-sign-in'
import { SsoSignIn } from './sso-sign-in'

/**
 * The signed-out screen of a server with no accounts yet (`setupRequired` on `GET /v1/instance`):
 * "Set up this server", naming the server, and the sign-up methods it has on. There is no one
 * to sign in as, so it has no sign-in form, no "Welcome back" and no demo or pairing. The first
 * account becomes the server's admin (the API does that); once it is created the usual
 * onboarding runs, as after any sign-up.
 *
 * The server switcher stays, for someone who reached the wrong server.
 */
export function ServerSetup({ server }: Readonly<{ server: { host: string; name: string } }>) {
  const { t } = useTranslation()
  const { signUp } = useProductRuntime()
  const queryClient = useQueryClient()
  const apiBaseUrl = useServerSwitch()?.apiBaseUrl ?? null
  // OIDC_ONLY: the account comes through the identity provider only.
  const passwordSignIn = usePasswordSignIn()

  return (
    <SignUpScreen
      footer={(
        <>
          <SsoSignIn primary={!passwordSignIn} />
          <SocialSignIn />
          <ServerSwitcher />
        </>
      )}
      lead={<Text tone="muted" variant="meta">{t('auth.setup.lead', { host: server.host, name: server.name })}</Text>}
      onSubmit={async (email, password) => {
        const outcome = await signUp(email, password)
        // A refusal can mean someone set the server up in the meantime (on the web, say): ask
        // it again, so the screen turns into sign-in if it has.
        if (outcome.status !== 'accepted') void queryClient.invalidateQueries({ queryKey: instanceQueryKey(apiBaseUrl) })
        return outcome.status
      }}
      passwordSignIn={passwordSignIn}
      submitLabel={t('auth.setup.submit')}
      title={t('auth.setup.title')}
    />
  )
}
