import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import type { OnboardingJourneyView } from './onboarding-view-model'

type Step = 'welcome' | 'goals' | 'privacy' | 'account'
const STEPS: readonly Step[] = ['welcome', 'goals', 'privacy', 'account']
const GOALS_KEY = 'wondermoney.onboarding.goals'

export type OnboardingScreenProps = Readonly<{
  state: { status: 'loading' } | { status: 'invalid-id' } | { status: 'invalid-response' } | { status: 'error' } | { status: 'access-transition' } | { status: 'loaded'; view: OnboardingJourneyView }
  pending: boolean
  outcome: 'idle' | 'skip' | 'connect-bank'
  onSkip: () => void | Promise<void>
  onConnectBank: () => void | Promise<void>
  onCreateAccount: () => void | Promise<void>
  onRetry: () => void | Promise<void>
}>

export function OnboardingScreen({ state, pending, onSkip, onConnectBank, onCreateAccount, onRetry }: OnboardingScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (state.status === 'access-transition') return null
  if (state.status === 'loading' || state.status === 'invalid-id') return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View accessible accessibilityRole="progressbar" accessibilityLabel={t('onboarding.loading')} style={styles.loading}><View style={[styles.skeleton, styles.skeletonHeader, { backgroundColor: palette.muted }]} /><View style={[styles.skeleton, { width: 280, height: 18, backgroundColor: palette.muted }]} /><View style={[styles.skeleton, { width: 320, height: 18, backgroundColor: palette.muted }]} /></View></SafeAreaView>
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.centered}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(invalid ? 'onboarding.invalidResponse.title' : 'onboarding.error.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t(invalid ? 'onboarding.invalidResponse.message' : 'onboarding.error.message')}</Text><Button label={t('common.retry')} onPress={() => void onRetry()} palette={palette} primary /></View></SafeAreaView>
  }
  return <OnboardingJourney palette={palette} view={state.view} pending={pending} onSkip={onSkip} onConnectBank={onConnectBank} onCreateAccount={onCreateAccount} />
}

function OnboardingJourney({ palette, view, pending, onSkip, onConnectBank, onCreateAccount }: { palette: Palette; view: OnboardingJourneyView; pending: boolean; onSkip: () => void | Promise<void>; onConnectBank: () => void | Promise<void>; onCreateAccount: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('welcome')
  const [goals, setGoals] = useState<string[]>([])
  const index = STEPS.indexOf(step)

  useEffect(() => { if (process.env.NODE_ENV === 'test') return; void SecureStore.getItemAsync(GOALS_KEY).then((value) => { if (value) { const saved = JSON.parse(value) as string[]; setGoals(saved) } }).catch(() => undefined) }, [])
  const toggleGoal = (goal: string) => {
    const next = goals.includes(goal) ? goals.filter((item) => item !== goal) : goals.length < 2 ? [...goals, goal] : goals
    setGoals(next)
    void SecureStore.setItemAsync(GOALS_KEY, JSON.stringify(next)).catch(() => undefined)
  }
  const next = () => { if (index < STEPS.length - 1) setStep(STEPS[index + 1]) }
  const back = () => { if (index > 0) setStep(STEPS[index - 1]) }
  const finish = () => { if (!pending) void onSkip() }
  const goalOptions = ['all_in_one', 'spending', 'budget', 'investments_net_worth', 'financial_freedom', 'exploring'] as const
  const title = t(`onboarding.firstRun.${step}.headline`)
  // `privacy` makes its case through its own points; its description was a
  // restatement of the list sitting directly underneath it.
  const NO_DESCRIPTION = '\u0000'
  const resolvedDescription = t(`onboarding.firstRun.${step}.description`, { defaultValue: NO_DESCRIPTION })
  const description = resolvedDescription === NO_DESCRIPTION ? '' : resolvedDescription
  const accountStep = step === 'account'
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
    <View style={styles.header}><View style={styles.topbar}>{index > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.firstRun.back')} onPress={back} style={styles.back}><Text style={[styles.backLabel, { color: palette.foreground }]}>{'‹  '}{t('onboarding.firstRun.back')}</Text></Pressable> : <View />}{view.skipActionAvailable ? <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.firstRun.skip')} disabled={pending} onPress={finish} style={styles.skipButton}><Text style={[styles.skip, { color: palette.mutedForeground }]}>{t('onboarding.firstRun.skip')}</Text></Pressable> : null}</View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.page}>
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: STEPS.length, now: index + 1 }} style={styles.progressRow}><View style={styles.segmentRail}>{STEPS.map((item, position) => <View key={item} style={[styles.segment, { backgroundColor: position <= index ? palette.primary : palette.border }]} />)}</View><Text style={[styles.progressText, { color: palette.mutedForeground }]}>{t('onboarding.firstRun.progress', { current: index + 1, total: STEPS.length })}</Text></View>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{title}</Text>{description ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{description}</Text> : null}
      {step === 'goals' ? <View style={styles.options}>{goalOptions.map((goal) => { const selected = goals.includes(goal); const label = t(`onboarding.firstRun.goals.options.${goal}`); return <Pressable key={goal} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: selected }} onPress={() => toggleGoal(goal)} style={[styles.option, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : palette.card }]}><View style={[styles.checkbox, { borderColor: selected ? palette.primary : palette.mutedForeground, backgroundColor: selected ? palette.primary : 'transparent' }]}>{selected ? <Text style={styles.check}>✓</Text> : null}</View><Text style={[styles.optionTitle, { color: palette.foreground }]}>{label}</Text></Pressable> })}</View> : null}
      {step === 'privacy' ? <View style={styles.points}>{(['readOnly', 'bankAuth', 'revoke'] as const).map((item) => <Point key={item} palette={palette} text={t(`onboarding.firstRun.privacy.points.${item}`)} />)}</View> : null}
    </View></ScrollView>
    <View style={[styles.footer, { borderColor: palette.border, backgroundColor: palette.background }]}>{accountStep ? <><Button label={t('onboarding.firstRun.account.cta')} onPress={() => void onConnectBank()} palette={palette} primary disabled={pending || !view.primaryActionAvailable} /><Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.firstRun.account.manualCta')} disabled={pending || !view.createAccountActionAvailable} onPress={() => void onCreateAccount()}><Text style={[styles.subordinate, { color: palette.primary }]}>{t('onboarding.firstRun.account.manualCta')}</Text></Pressable></> : <Button label={t(`onboarding.firstRun.${step}.cta`, { defaultValue: t('onboarding.firstRun.continue') })} onPress={next} palette={palette} primary disabled={step === 'goals' && goals.length === 0} />}</View>
  </SafeAreaView>
}

/** One fact on a line. No border: three sentences do not need three boxes. */
function Point({ palette, title, text }: { palette: Palette; title?: string; text: string }) { return <View style={styles.point}><View style={[styles.dot, { backgroundColor: palette.mutedForeground }]} /><Text style={[styles.pointText, { color: palette.foreground }]}>{title ? <Text style={styles.pointTitle}>{title}. </Text> : null}<Text style={{ color: palette.mutedForeground }}>{text}</Text></Text></View> }
function Button({ label, onPress, palette, primary = false, disabled = false }: { label: string; onPress: () => void; palette: Palette; primary?: boolean; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.pressed]}><Text style={[styles.buttonLabel, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable> }

const styles = StyleSheet.create({ safeArea: { flex: 1 }, header: { paddingHorizontal: themeTokens.spacing[6], paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[2] }, topbar: { minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' }, skipButton: { minHeight: 44, justifyContent: 'center' }, backLabel: { ...textStyles.body }, skip: { ...textStyles.meta, textDecorationLine: 'underline' }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingTop: themeTokens.spacing[3] }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] }, progressRow: { gap: themeTokens.spacing[2] }, segmentRail: { flexDirection: 'row', gap: 5 }, segment: { flex: 1, height: 4, borderRadius: themeTokens.radius.pill }, progressText: { ...textStyles.label }, title: { ...textStyles.title }, body: { ...textStyles.body }, options: { gap: themeTokens.spacing[3] }, points: { gap: themeTokens.spacing[3] }, point: { flexDirection: 'row', gap: themeTokens.spacing[3] }, dot: { width: 4, height: 4, borderRadius: themeTokens.radius.pill, marginTop: 9 }, pointText: { ...textStyles.body, flex: 1 }, pointTitle: { fontWeight: '600' as const }, option: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], gap: themeTokens.spacing[3], minHeight: themeTokens.touchTarget.minimum }, checkbox: { width: 24, height: 24, borderRadius: themeTokens.radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, check: { color: themeTokens.colors.light.primaryForeground, fontWeight: '700' as const }, optionTitle: { ...textStyles.action }, footer: { borderTopWidth: 1, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: themeTokens.spacing[4] }, buttonLabel: { ...textStyles.action }, subordinate: { ...textStyles.bodyStrong, fontWeight: '600' as const, textAlign: 'center', paddingVertical: themeTokens.spacing[2] }, pressed: { opacity: 0.65 }, loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] }, skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm }, skeletonHeader: { width: '100%', height: 80 }, centered: { flex: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] } })
