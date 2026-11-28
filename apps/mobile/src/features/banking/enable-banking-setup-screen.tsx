import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsField, SettingsInput, SettingsNotice } from '@/features/more/settings-ui'
import { normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  ENABLE_BANKING_APPLICATIONS_URL,
  ENABLE_BANKING_SETUP_STEP,
  ENABLE_BANKING_SETUP_STEPS,
  ENABLE_BANKING_SIGN_IN_URL,
  type EnableBankingControlPanelValue,
  type EnableBankingSetupFailure,
  type EnableBankingSetupScreenStepId,
  enableBankingSetupFailureMessageKey,
  enableBankingSetupStepNumber,
  nextEnableBankingSetupStep,
  normalizeApplicationId,
  previousEnableBankingSetupStep,
} from './enable-banking-setup-view-model'

/**
 * What the screen shows: the steps; or, before any step, why the person can't do them now. A
 * household viewer can't add a key; a session too old for the server's sensitive actions is
 * renewed first, so nobody does steps 1 and 2 only to be sent to sign in.
 */
export type EnableBankingSetupGate = 'steps' | 'read-only' | 'sign-in-again'

/** Where the Control Panel values stand (`useEnableBankingSetup`). */
export type EnableBankingSetupValuesStatus = 'loading' | 'failed' | 'missing' | 'ready'

export type EnableBankingSetupScreenProps = Readonly<{
  gate: EnableBankingSetupGate
  /** Where the setup opens (`initialEnableBankingSetupStep`). */
  initialStep: EnableBankingSetupScreenStepId
  /** The server's shared credential serves another household, so this one needs its own key. */
  sharedUnavailable: boolean
  /** This server's Control Panel values, in the form's order. */
  values: readonly EnableBankingControlPanelValue[]
  valuesStatus: EnableBankingSetupValuesStatus
  onRetryValues: () => void
  /** The certificate made in this visit; the server never hands it out again. */
  certificatePem: string | null
  /** When a certificate made earlier lapses (ISO), if one is waiting for its application ID. */
  pendingExpiresAt: string | null
  creatingCertificate: boolean
  activating: boolean
  failure: EnableBankingSetupFailure | null
  /** Two-factor is on: the server asked for the code, so each sensitive step shows the field. */
  askForCode: boolean
  onBack: () => void
  /** Opens Enable Banking beside the app; false when no browser would take it. */
  onOpenUrl: (url: string) => Promise<boolean>
  onCreateCertificate: (totpCode: string | undefined) => void
  onActivate: (applicationId: string, totpCode: string | undefined) => void
  onCopy: (value: string) => Promise<boolean>
  onShareCertificate: () => Promise<boolean>
  onReadClipboard: () => Promise<string | null>
  onSignInAgain: () => void
}>

type CopyState = Readonly<{ key: string; ok: boolean }> | null

/**
 * The Enable Banking key setup, step by step beside the Control Panel, which opens in Safari on
 * iOS and a Custom Tab on Android (`enable-banking-setup-device.ts`). The web wizard's steps
 * (#696): sign in, create the application, activate it by linking accounts, paste the
 * application ID; the fifth, choosing the bank, is the connect screen's bank list, which takes
 * over once the key is active. A flow route, without the shell bar.
 */
export function EnableBankingSetupScreen(props: EnableBankingSetupScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const { failure, askForCode } = props
  const [step, setStep] = useState<EnableBankingSetupScreenStepId>(props.initialStep)
  const [applicationId, setApplicationId] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [copyState, setCopyState] = useState<CopyState>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  // iOS opens Safari, Android a Custom Tab: the copy says how to go back and forth with each.
  const browser = Platform.OS === 'ios' ? 'ios' : 'android'

  const stepTitle = (id: EnableBankingSetupScreenStepId) => t(`banking.keySetup.steps.${id}`)
  const formatDate = (iso: string) => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const code = () => {
    const normalized = normalizeTotpCode(totpCode)
    return normalized.length > 0 ? normalized : undefined
  }

  const copy = async (key: string, value: string) => {
    setNotice(null)
    setCopyState({ key, ok: await props.onCopy(value) })
  }

  const goTo = (next: EnableBankingSetupScreenStepId) => {
    // "Copied." and a paste or browser notice belong to the step they were said on.
    setNotice(null)
    setCopyState(null)
    setOpenFailed(false)
    setStep(next)
  }

  const previous = previousEnableBankingSetupStep(step)
  const total = ENABLE_BANKING_SETUP_STEPS.length

  const failureNotice = failure ? (
    <SettingsNotice
      alert
      message={t(enableBankingSetupFailureMessageKey(failure.reason))}
      tone="destructive"
      action={failure.reason === 'session-not-fresh' ? (
        <Button label={t('banking.keySetup.signInAgain')} onPress={props.onSignInAgain} size="sm" variant="outline" />
      ) : failure.revisit && failure.revisit !== step ? (
        <Button
          label={t('banking.keySetup.revisit', { number: enableBankingSetupStepNumber(failure.revisit), title: stepTitle(failure.revisit) })}
          onPress={() => { if (failure.revisit) goTo(failure.revisit) }}
          size="sm"
          variant="outline"
        />
      ) : undefined}
    />
  ) : null

  const codeField = askForCode ? (
    <SettingsField label={t('banking.keySetup.totpLabel')}>
      <SettingsInput
        accessibilityHint={t('banking.keySetup.totpHint')}
        accessibilityLabel={t('banking.keySetup.totpLabel')}
        autoComplete="one-time-code"
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={8}
        onChangeText={setTotpCode}
        placeholder="123456"
        textContentType="oneTimeCode"
        value={totpCode}
      />
      <Text tone="muted" variant="label">{t('banking.keySetup.totpHint')}</Text>
    </SettingsField>
  ) : null

  const copiedLine = (key: string) => copyState?.key === key ? (
    <Text accessibilityLiveRegion="polite" tone={copyState.ok ? 'muted' : 'destructive'} variant="label">
      {t(copyState.ok ? 'banking.keySetup.copied' : 'banking.keySetup.copyFailed')}
    </Text>
  ) : null

  const open = async (url: string) => {
    setOpenFailed(!(await props.onOpenUrl(url)))
  }

  const openFailedNotice = openFailed ? (
    <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('banking.keySetup.openFailed')}</Text>
  ) : null

  const openControlPanel = (
    <>
      <Button
        accessibilityHint={t(`banking.keySetup.openHint.${browser}`)}
        icon="external-link"
        label={t('banking.keySetup.create.openControlPanel')}
        onPress={() => open(ENABLE_BANKING_APPLICATIONS_URL)}
        variant="outline"
      />
      {openFailedNotice}
    </>
  )

  const navigation = (primary: ReactNode) => (
    <View style={styles.navigation}>
      {previous ? (
        <Button label={t('banking.keySetup.previous')} onPress={() => goTo(previous)} variant="outline" />
      ) : null}
      <View style={styles.navigationPrimary}>{primary}</View>
    </View>
  )

  const continueButton = (disabled = false) => (
    <Button block disabled={disabled} label={t('banking.keySetup.continue')} onPress={() => goTo(nextEnableBankingSetupStep(step))} />
  )

  const busy = props.creatingCertificate || props.activating

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.page} testID={`enable-banking-setup-${props.gate === 'steps' ? step : props.gate}`}>
            <BackControl disabled={busy} fallback="/more/banking" label={t('banking.connect.back')} onPress={props.onBack} />
            <PageHeader title={t('banking.keySetup.heading')} instruction={t('banking.keySetup.helper')} />
            {props.sharedUnavailable ? (
              <Text tone="muted" variant="meta">{t('banking.connect.credentialRequired.sharedUnavailable')}</Text>
            ) : null}

            {props.gate === 'read-only' ? (
              <SettingsNotice message={t('banking.keySetup.viewerNotice')} title={t('banking.keySetup.viewerTitle')} />
            ) : null}

            {props.gate === 'sign-in-again' ? (
              <SettingsNotice
                action={<Button label={t('banking.keySetup.signInAgain')} onPress={props.onSignInAgain} />}
                message={t('banking.keySetup.staleSessionMessage')}
                title={t('banking.keySetup.staleSessionTitle')}
              />
            ) : null}

            {props.gate === 'steps' ? (
              <View style={styles.stepHead}>
                <Text tone="muted" variant="label">{t('banking.keySetup.stepOf', { number: enableBankingSetupStepNumber(step), total })}</Text>
                <Text accessibilityRole="header" variant="section">{stepTitle(step)}</Text>
              </View>
            ) : null}

            {props.gate === 'steps' && step === ENABLE_BANKING_SETUP_STEP.signIn ? (
              <>
                <Text variant="body">{t('banking.keySetup.signIn.body')}</Text>
                <Text tone="muted" variant="meta">{t('banking.keySetup.signIn.mailHint')}</Text>
                <Button
                  accessibilityHint={t(`banking.keySetup.openHint.${browser}`)}
                  icon="external-link"
                  label={t('banking.keySetup.signIn.open')}
                  onPress={() => open(ENABLE_BANKING_SIGN_IN_URL)}
                  variant="outline"
                />
                {openFailedNotice}
                {navigation(continueButton())}
              </>
            ) : null}

            {props.gate === 'steps' && step === ENABLE_BANKING_SETUP_STEP.createApplication ? (
              <>
                <Text variant="body">{t('banking.keySetup.create.certificateIntro')}</Text>
                {props.certificatePem ? (
                  <View style={styles.group}>
                    <Button
                      icon="copy"
                      label={t('banking.keySetup.create.copyCertificate')}
                      onPress={() => copy('certificate', props.certificatePem ?? '')}
                      variant="outline"
                    />
                    <Button
                      icon="share"
                      label={t('banking.keySetup.create.shareCertificate')}
                      onPress={async () => {
                        setCopyState(null)
                        setNotice((await props.onShareCertificate()) ? null : t('banking.keySetup.create.shareFailed'))
                      }}
                      variant="outline"
                    />
                    {copiedLine('certificate')}
                    {notice ? <Text accessibilityRole="alert" tone="destructive" variant="label">{notice}</Text> : null}
                    <Text tone="muted" variant="meta">{t('banking.keySetup.create.certificateHint')}</Text>
                  </View>
                ) : (
                  <View style={styles.group}>
                    {props.pendingExpiresAt ? (
                      <Text tone="muted" variant="meta">{t('banking.keySetup.create.pendingNotice', { date: formatDate(props.pendingExpiresAt) })}</Text>
                    ) : null}
                    {codeField}
                    <Button
                      label={t(props.pendingExpiresAt ? 'banking.keySetup.create.recreate' : 'banking.keySetup.create.createCertificate')}
                      loading={props.creatingCertificate}
                      onPress={() => {
                        const totp = code()
                        setTotpCode('')
                        props.onCreateCertificate(totp)
                      }}
                      variant={props.pendingExpiresAt ? 'outline' : 'primary'}
                    />
                  </View>
                )}
                {failureNotice}

                <Banner
                  message={t('banking.keySetup.create.productionMessage')}
                  title={t('banking.keySetup.create.productionTitle')}
                  tone="warning"
                />
                <Text variant="body">{t('banking.keySetup.create.formIntro')}</Text>
                {props.valuesStatus !== 'ready' ? (
                  <SettingsNotice
                    action={props.valuesStatus === 'loading' ? undefined : (
                      <Button label={t('common.retry')} onPress={props.onRetryValues} size="sm" variant="outline" />
                    )}
                    message={t(`banking.keySetup.values.${props.valuesStatus}`)}
                    tone={props.valuesStatus === 'loading' ? 'default' : 'destructive'}
                  />
                ) : null}
                <View style={[styles.values, { borderColor: palette.border }]}>
                  <ValueRow first label={t('banking.keySetup.fields.environment')} value={t('banking.keySetup.fields.production')} />
                  {props.values.map(({ field, value }) => {
                    const label = t(`banking.keySetup.fields.${field}`)
                    return (
                      <ValueRow
                        key={field}
                        label={label}
                        value={value}
                        copied={copyState?.key === field && copyState.ok}
                        copyLabel={t('banking.keySetup.copyValue', { field: label })}
                        onCopy={() => copy(field, value)}
                        status={copyState?.key === field && !copyState.ok ? t('banking.keySetup.copyFailed') : null}
                      />
                    )
                  })}
                </View>
                <Text variant="body">{t('banking.keySetup.create.keyChoice')}</Text>
                {openControlPanel}
                <Text tone="muted" variant="meta">{t(`banking.keySetup.create.switchHint.${browser}`)}</Text>
                {navigation(props.certificatePem || props.pendingExpiresAt ? continueButton() : null)}
              </>
            ) : null}

            {props.gate === 'steps' && step === ENABLE_BANKING_SETUP_STEP.activate ? (
              <>
                <Text variant="body">{t('banking.keySetup.activate.body')}</Text>
                <Banner message={t('banking.keySetup.activate.warning')} tone="warning" />
                {failureNotice}
                {openControlPanel}
                {navigation(continueButton())}
              </>
            ) : null}

            {props.gate === 'steps' && step === ENABLE_BANKING_SETUP_STEP.applicationId ? (
              <>
                <Text variant="body">{t('banking.keySetup.applicationId.body')}</Text>
                {props.pendingExpiresAt ? (
                  <Text tone="muted" variant="meta">{t('banking.keySetup.applicationId.waiting', { date: formatDate(props.pendingExpiresAt) })}</Text>
                ) : null}
                <SettingsField label={t('banking.keySetup.applicationId.label')}>
                  <View style={styles.inputRow}>
                    <View style={styles.inputGrow}>
                      <SettingsInput
                        accessibilityLabel={t('banking.keySetup.applicationId.label')}
                        autoCapitalize="none"
                        autoComplete="off"
                        autoCorrect={false}
                        editable={!props.activating}
                        importantForAutofill="no"
                        onChangeText={setApplicationId}
                        placeholder={t('banking.keySetup.applicationId.placeholder')}
                        spellCheck={false}
                        testID="enable-banking-application-id"
                        value={applicationId}
                      />
                    </View>
                    <Button
                      icon="clipboard-paste"
                      label={t('banking.keySetup.applicationId.paste')}
                      onPress={async () => {
                        const pasted = await props.onReadClipboard()
                        if (pasted) {
                          setNotice(null)
                          setApplicationId(normalizeApplicationId(pasted))
                        } else {
                          setNotice(t('banking.keySetup.applicationId.pasteEmpty'))
                        }
                      }}
                      variant="outline"
                    />
                  </View>
                  {notice ? <Text accessibilityRole="alert" tone="destructive" variant="label">{notice}</Text> : null}
                </SettingsField>
                {codeField}
                {failureNotice}
                {navigation(
                  <Button
                    block
                    disabled={normalizeApplicationId(applicationId).length === 0}
                    label={t(props.activating ? 'banking.keySetup.applicationId.submitting' : 'banking.keySetup.applicationId.submit')}
                    loading={props.activating}
                    onPress={() => {
                      const totp = code()
                      setTotpCode('')
                      props.onActivate(normalizeApplicationId(applicationId), totp)
                    }}
                  />,
                )}
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** One Control Panel value: its label, the value in Mono (selectable), and a copy button. */
function ValueRow({ first = false, label, value, copied = false, copyLabel, onCopy, status = null }: {
  first?: boolean
  label: string
  value: string
  copied?: boolean
  copyLabel?: string
  onCopy?: () => void
  status?: string | null
}) {
  const palette = usePalette()
  return (
    <View style={[styles.valueRow, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
      <View style={styles.valueText}>
        <Text tone="muted" variant="label">{label}</Text>
        <Text selectable variant="amountSmall">{value}</Text>
        {status ? <Text accessibilityRole="alert" tone="destructive" variant="label">{status}</Text> : null}
      </View>
      {onCopy && copyLabel ? (
        <Button icon={copied ? 'check' : 'copy'} label={copyLabel} onPress={onCopy} size="icon" variant="outline" />
      ) : null}
    </View>
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
  stepHead: { gap: themeTokens.spacing[1] },
  group: { gap: themeTokens.spacing[2] },
  values: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  valueRow: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[3],
  },
  valueText: { flex: 1, gap: themeTokens.spacing[1] },
  inputRow: { flexDirection: 'row', gap: themeTokens.spacing[2], alignItems: 'center' },
  inputGrow: { flex: 1 },
  navigation: { flexDirection: 'row', gap: themeTokens.spacing[2], alignItems: 'center' },
  navigationPrimary: { flex: 1 },
})
