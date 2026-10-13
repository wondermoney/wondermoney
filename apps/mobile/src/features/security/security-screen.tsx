import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { selfStyles, type Palette } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { AppLockSection, type AppLockSectionProps } from './app-lock-section'
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
}

export function SecurityScreen({ pending, outcome, onBack, onDelete, mfa, password, appLock }: SecurityScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [acknowledged, setAcknowledged] = useState(false)
  const canDelete = acknowledged && !pending

  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={selfStyles.content}>
        <View style={selfStyles.page}>
          <BackControl fallback="/more" label={t('self.back')} onPress={onBack} disabled={pending} />

          <PageHeader palette={palette}
            helpText={t('security.helper')} title={t('security.title')} />

          <PasswordChangeSection {...password} palette={palette} />

          <MfaSecuritySection {...mfa} palette={palette} />

          <AppLockSection {...appLock} palette={palette} />

          <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.cardTitle, { color: palette.foreground }]}>
              {t('security.deleteHeading')}
            </Text>
            <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
              {t('security.deleteExplainer')}
            </Text>
            <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
              {t('security.distinctFromSignOut')}
            </Text>
            <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
              {t('security.distinctFromBank')}
            </Text>
            <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
              {t('security.irreversible')}
            </Text>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acknowledged, disabled: pending }}
            accessibilityLabel={t('security.acknowledge')}
            disabled={pending}
            onPress={() => setAcknowledged((value) => !value)}
            style={({ pressed }) => [styles.ackRow, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: palette.primary },
                acknowledged && { backgroundColor: palette.primary },
              ]}
            >
              {acknowledged ? (
                <Text accessible={false} style={[styles.checkmark, { color: palette.background }]}>✓</Text>
              ) : null}
            </View>
            <Text allowFontScaling style={[styles.ackLabel, { color: palette.foreground }]}>
              {t('security.acknowledge')}
            </Text>
          </Pressable>

          {outcome ? (
            <View
              accessible
              accessibilityRole="alert"
              style={[styles.error, { borderColor: palette.destructive, backgroundColor: palette.muted }]}
            >
              <Text allowFontScaling style={[styles.errorText, { color: palette.foreground }]}>
                {t(`security.errors.${outcome}`)}
              </Text>
            </View>
          ) : null}

          <DestructiveButton
            label={pending ? t('security.deleting') : t('security.deleteAction')}
            busy={pending}
            disabled={!canDelete}
            onPress={onDelete}
            palette={palette}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function DestructiveButton({ label, busy, disabled, onPress, palette }: {
  label: string
  busy: boolean
  disabled: boolean
  onPress: () => void | Promise<void>
  palette: Palette
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.destructive,
        { borderColor: palette.destructive, backgroundColor: palette.destructive },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.destructiveLabel, { color: palette.background }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  cardTitle: { ...textStyles.section },
  cardBody: { ...textStyles.body },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    minHeight: themeTokens.touchTarget.minimum,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderWidth: 2,
    borderRadius: themeTokens.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { ...textStyles.action, fontWeight: '700' as const },
  ackLabel: { ...textStyles.body, flex: 1 },
  error: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[4],
  },
  errorText: { ...textStyles.body },
  destructive: {
    minHeight: themeTokens.touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
  },
  destructiveLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
})
