import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsPage, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { AppLockSection, type AppLockSectionProps } from './app-lock-section'
import { DataExportSection, type DataExportSectionProps } from './data-export-section'
import { MfaSecuritySection, type MfaSecuritySectionProps } from './mfa-security-section'
import { PasswordChangeSection, type PasswordChangeSectionProps } from './password-change-section'
import type { DeleteAccountFailure } from './use-delete-account'

export type SecurityScreenProps = {
  pending: boolean
  outcome: DeleteAccountFailure | null
  onBack: () => void
  onDelete: () => void | Promise<void>
  mfa: Omit<MfaSecuritySectionProps, 'palette'>
  password: Omit<PasswordChangeSectionProps, 'palette'>
  appLock: Omit<AppLockSectionProps, 'palette'>
  dataExport: DataExportSectionProps
}

export function SecurityScreen({ pending, outcome, onBack, onDelete, mfa, password, appLock, dataExport }: SecurityScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [acknowledged, setAcknowledged] = useState(false)
  const canDelete = acknowledged && !pending

  return (
    <SettingsPage backDisabled={pending} backLabel={t('self.back')} onBack={onBack} section="security">
      <PasswordChangeSection {...password} palette={palette} />

      <MfaSecuritySection {...mfa} palette={palette} />

      <AppLockSection {...appLock} palette={palette} />

      <DataExportSection {...dataExport} />

      <SettingsSection title={t('security.deleteHeading')} description={t('security.deleteExplainer')}>
        <View style={styles.facts}>
          <Text tone="muted" variant="meta">{t('security.distinctFromSignOut')}</Text>
          <Text tone="muted" variant="meta">{t('security.distinctFromBank')}</Text>
          <Text variant="metaStrong">{t('security.irreversible')}</Text>
        </View>

        <Pressable
          accessibilityLabel={t('security.acknowledge')}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged, disabled: pending }}
          disabled={pending}
          hitSlop={4}
          onPress={() => setAcknowledged((value) => !value)}
          style={({ pressed }) => [styles.ackRow, pressed && styles.pressed]}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: acknowledged ? palette.primary : palette.input },
              acknowledged && { backgroundColor: palette.primary },
            ]}
          >
            {acknowledged ? <Icon color={palette.primaryForeground} name="check" size={14} weight="bold" /> : null}
          </View>
          <Text style={styles.ackLabel} variant="meta">{t('security.acknowledge')}</Text>
        </Pressable>

        {outcome ? <SettingsNotice alert message={t(`security.errors.${outcome}`)} tone="destructive" /> : null}

        <Button
          block
          disabled={!canDelete}
          label={pending ? t('security.deleting') : t('security.deleteAction')}
          loading={pending}
          onPress={() => void onDelete()}
          variant="destructive"
        />
      </SettingsSection>
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  facts: { gap: themeTokens.spacing[2] },
  // Web's `Checkbox`: a 16pt box with a 4pt radius, label beside it.
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    minHeight: themeTokens.touchTarget.minimum,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: themeTokens.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackLabel: { flex: 1 },
  pressed: { opacity: 0.72 },
})
