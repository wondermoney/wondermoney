import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsField, SettingsInput, SettingsNotice } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { simplefinConnectFailureMessageKey, type SimplefinConnectFailure } from './use-connect-simplefin'

export type SimplefinConnectScreenProps = Readonly<{
  submitting: boolean
  failure: SimplefinConnectFailure | null
  onBack: () => void
  /** Called with the trimmed token; the field is cleared as it is sent. */
  onSubmit: (setupToken: string) => void
  onOpenBridge: () => void
}>

/**
 * Connect with SimpleFIN: paste a one-time setup token from SimpleFIN Bridge. A flow route (no
 * shell bar), like the bank picker. The token lives only in this field's state and is cleared
 * the moment it is sent, whatever the outcome: it works once, so there is nothing to resend.
 */
export function SimplefinConnectScreen({ submitting, failure, onBack, onSubmit, onOpenBridge }: SimplefinConnectScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [setupToken, setSetupToken] = useState('')
  const trimmed = setupToken.trim()

  const submit = () => {
    if (!trimmed || submitting) return
    setSetupToken('')
    onSubmit(trimmed)
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
            <BackControl disabled={submitting} fallback="/more/banking" label={t('banking.connect.back')} onPress={onBack} />
            <PageHeader title={t('banking.simplefin.heading')} instruction={t('banking.simplefin.helper')} />

            <View style={styles.explainer}>
              <Text tone="muted" variant="meta">{t('banking.simplefin.tokenExplainer')}</Text>
              <Text tone="muted" variant="meta">{t('banking.simplefin.storageExplainer')}</Text>
              <Button
                accessibilityHint={t('banking.simplefin.bridgeLinkHint')}
                icon="external-link"
                label={t('banking.simplefin.bridgeLink')}
                onPress={onOpenBridge}
                size="sm"
                variant="outline"
              />
            </View>

            {failure ? (
              <SettingsNotice
                alert
                message={failure.reason === 'rejected' && failure.serverMessage
                  ? failure.serverMessage
                  : t(simplefinConnectFailureMessageKey(failure.reason))}
                tone="destructive"
              />
            ) : null}

            <SettingsField label={t('banking.simplefin.tokenLabel')}>
              <SettingsInput
                accessibilityLabel={t('banking.simplefin.tokenLabel')}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                editable={!submitting}
                importantForAutofill="no"
                multiline
                onChangeText={setSetupToken}
                placeholder={t('banking.simplefin.tokenPlaceholder')}
                spellCheck={false}
                style={styles.tokenInput}
                testID="simplefin-setup-token"
                textAlignVertical="top"
                textContentType="none"
                value={setupToken}
              />
            </SettingsField>

            <Button
              block
              disabled={!trimmed}
              label={submitting ? t('banking.simplefin.connecting') : t('banking.simplefin.submit')}
              loading={submitting}
              onPress={submit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: themeTokens.layout.blockGap,
  },
  explainer: { gap: themeTokens.spacing[2], alignItems: 'flex-start' },
  // Room for a pasted token, which wraps over a few lines.
  tokenInput: { minHeight: 96, paddingVertical: themeTokens.spacing[3] },
})
