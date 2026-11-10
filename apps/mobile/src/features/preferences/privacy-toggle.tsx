import { useTranslation } from 'react-i18next'

import { IconButton } from '@/components/ui/icon-button'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'

/**
 * The quick privacy-mode switch for a page header: an eye while amounts show,
 * a struck-through eye while they are hidden. The label names the action the
 * tap performs, so a screen reader says "Hide amounts" or "Show amounts".
 */
export function PrivacyToggle({ testID = 'privacy-toggle' }: { testID?: string }) {
  const { t } = useTranslation()
  const { hidden, toggle } = usePrivacyMode()
  return (
    <IconButton
      accessibilityLabel={hidden ? t('privacy.show') : t('privacy.hide')}
      icon={hidden ? 'eye-off' : 'eye'}
      onPress={toggle}
      testID={testID}
    />
  )
}
