import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { AuthLayout } from './auth-form-styles'

export type InviteInvalidScreenProps = {
  onBackToSignIn: () => void
  onContinueWithoutInvite: () => void
}

/** Mirrors web's /join invalid-token state, adapted with a path back into normal sign-up
 * since mobile has no dedicated /join page — the invite flow lives inside /sign-up. */
export function InviteInvalidScreen({ onBackToSignIn, onContinueWithoutInvite }: InviteInvalidScreenProps) {
  const { t } = useTranslation()

  return (
    <AuthLayout
      lead={<Text tone="muted" variant="meta">{t('auth.join.invalidBody')}</Text>}
      title={t('auth.join.invalidTitle')}
    >
      <Button block label={t('auth.join.continueWithoutInvite')} onPress={onContinueWithoutInvite} />
      <Button block label={t('auth.join.backToSignIn')} onPress={onBackToSignIn} variant="ghost" />
    </AuthLayout>
  )
}
