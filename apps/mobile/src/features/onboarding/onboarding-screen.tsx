import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import type { OnboardingJourneyView } from './onboarding-view-model'
import type { CompleteOnboardingFailure } from './use-complete-onboarding'

export type OnboardingCompletionFailure = Exclude<CompleteOnboardingFailure, 'access' | 'cancelled'>

type Step = 'welcome' | 'goals' | 'privacy' | 'account'
const STEPS: readonly Step[] = ['welcome', 'goals', 'privacy', 'account']
const GOALS_KEY = 'wondermoney.onboarding.goals'

export type OnboardingScreenProps = Readonly<{
  state: { status: 'loading' } | { status: 'invalid-id' } | { status: 'invalid-response' } | { status: 'error' } | { status: 'access-transition' } | { status: 'loaded'; view: OnboardingJourneyView }
  pending: boolean
  /** Why the last skip/complete attempt failed, or null. */
  completionFailure?: OnboardingCompletionFailure | null
  outcome: 'idle' | 'skip' | 'connect-bank'
  onSkip: () => void | Promise<void>
  onConnectBank: () => void | Promise<void>
  onCreateAccount: () => void | Promise<void>
  onRetry: () => void | Promise<void>
}>

export function OnboardingScreen({ state, pending, completionFailure = null, onSkip, onConnectBank, onCreateAccount, onRetry }: OnboardingScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'access-transition') return null
  if (state.status === 'loading' || state.status === 'invalid-id') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <OnboardingHeader />
        <View accessible accessibilityLabel={t('onboarding.loading')} accessibilityRole="progressbar" style={styles.loading}>
          <View style={[styles.skeleton, { width: '100%', height: 2, backgroundColor: palette.muted }]} />
          <View style={[styles.skeleton, { width: '80%', height: 32, backgroundColor: palette.muted }]} />
          <View style={[styles.skeleton, { width: '100%', height: 20, backgroundColor: palette.muted }]} />
          <View style={[styles.skeleton, { width: '90%', height: 20, backgroundColor: palette.muted }]} />
        </View>
      </SafeAreaView>
    )
  }
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <OnboardingHeader />
        <View style={styles.centered}>
          <Text accessibilityRole="header" variant="title">{t(invalid ? 'onboarding.invalidResponse.title' : 'onboarding.error.title')}</Text>
          <Text tone="muted" variant="meta">{t(invalid ? 'onboarding.invalidResponse.message' : 'onboarding.error.message')}</Text>
          <Button label={t('common.retry')} onPress={() => void onRetry()} />
        </View>
      </SafeAreaView>
    )
  }
  return <OnboardingJourney palette={palette} view={state.view} pending={pending} completionFailure={completionFailure} onSkip={onSkip} onConnectBank={onConnectBank} onCreateAccount={onCreateAccount} />
}

/**
 * Web's first-run shell (`FirstRunOnboardingShell`): a 56pt bar with the wordmark and a
 * hairline, a segmented progress line with "Step n of N" and the step's name, the step,
 * and a footer bar with Back on the left and the step's action on the right.
 */
function OnboardingHeader({ action }: { action?: React.ReactNode }) {
  const palette = usePalette()
  const dark = useColorScheme() === 'dark'
  return (
    <View style={[styles.header, { borderBottomColor: palette.border }]}>
      <Image
        accessible={false}
        resizeMode="contain"
        source={dark ? require('@/assets/images/wondermoney-logo-dark.png') : require('@/assets/images/wondermoney-logo.png')}
        style={styles.logo}
      />
      {action}
    </View>
  )
}

const GOAL_OPTIONS = ['all_in_one', 'spending', 'budget', 'investments_net_worth', 'financial_freedom', 'exploring'] as const
type Goal = (typeof GOAL_OPTIONS)[number]
type Tone = 'violet' | 'sky' | 'green' | 'slate'
const GOAL_ICONS: Record<Goal, { icon: IconName; tone: Tone }> = {
  all_in_one: { icon: 'wallet-cards', tone: 'violet' },
  spending: { icon: 'bar-chart', tone: 'sky' },
  budget: { icon: 'piggy-bank', tone: 'sky' },
  investments_net_worth: { icon: 'line-chart', tone: 'violet' },
  financial_freedom: { icon: 'circle-dollar-sign', tone: 'green' },
  exploring: { icon: 'compass', tone: 'slate' },
}
const WELCOME_FACTS: readonly { key: 'connected' | 'readOnly' | 'netWorth'; icon: IconName; tone: Tone }[] = [
  { key: 'connected', icon: 'layers', tone: 'violet' },
  { key: 'readOnly', icon: 'shield-check', tone: 'slate' },
  { key: 'netWorth', icon: 'trending-up', tone: 'green' },
]
const MAX_GOALS = 2

function OnboardingJourney({ palette, view, pending, completionFailure, onSkip, onConnectBank, onCreateAccount }: { palette: Palette; view: OnboardingJourneyView; pending: boolean; completionFailure: OnboardingCompletionFailure | null; onSkip: () => void | Promise<void>; onConnectBank: () => void | Promise<void>; onCreateAccount: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('welcome')
  const [goals, setGoals] = useState<string[]>([])
  const index = STEPS.indexOf(step)

  useEffect(() => { if (process.env.NODE_ENV === 'test') return; void SecureStore.getItemAsync(GOALS_KEY).then((value) => { if (value) { const saved = JSON.parse(value) as string[]; setGoals(saved) } }).catch(() => undefined) }, [])
  const toggleGoal = (goal: string) => {
    const next = goals.includes(goal) ? goals.filter((item) => item !== goal) : goals.length < MAX_GOALS ? [...goals, goal] : goals
    setGoals(next)
    void SecureStore.setItemAsync(GOALS_KEY, JSON.stringify(next)).catch(() => undefined)
  }
  const next = () => { if (index < STEPS.length - 1) setStep(STEPS[index + 1]) }
  const back = () => { if (index > 0) setStep(STEPS[index - 1]) }
  const finish = () => { if (!pending) void onSkip() }
  const title = t(`onboarding.firstRun.${step}.headline`)
  // `privacy` makes its case through its own points; its description was a
  // restatement of the list sitting directly underneath it.
  const NO_DESCRIPTION = '\u0000'
  const resolvedDescription = t(`onboarding.firstRun.${step}.description`, { defaultValue: NO_DESCRIPTION })
  const description = resolvedDescription === NO_DESCRIPTION ? '' : resolvedDescription
  const accountStep = step === 'account'
  const toneColor = (tone: Tone) => ({ violet: palette.primary, sky: palette.chart5, green: palette.chart3, slate: palette.mutedForeground }[tone])

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
    <OnboardingHeader
      action={view.skipActionAvailable ? (
        <Button accessibilityLabel={t('onboarding.firstRun.skip')} disabled={pending} label={t('onboarding.firstRun.skip')} onPress={finish} size="sm" variant="ghost" />
      ) : null}
    />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.page}>
      {completionFailure ? (
        <View accessible accessibilityLabel={t(`onboarding.completeFailure.${completionFailure}`)} accessibilityRole="alert" style={[styles.failure, { borderColor: palette.destructiveText }]}>
          <Text tone="destructive" variant="meta">{t(`onboarding.completeFailure.${completionFailure}`)}</Text>
        </View>
      ) : null}

      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: STEPS.length, now: index + 1 }} style={styles.progress}>
        <View style={styles.segmentRail}>
          {STEPS.map((item, position) => <View key={item} style={[styles.segment, { backgroundColor: position <= index ? palette.primary : palette.border }]} />)}
        </View>
        <View style={styles.progressText}>
          <Text tone="muted" variant="label">{t('onboarding.firstRun.progress', { current: index + 1, total: STEPS.length })}</Text>
          <Text style={styles.stepLabel} variant="label">{t(`onboarding.firstRun.stepLabels.${step}`)}</Text>
        </View>
      </View>

      <View style={styles.intro}>
        <Text accessibilityRole="header" variant="title">{title}</Text>
        {description ? <Text tone="muted" variant="meta">{description}</Text> : null}
      </View>

      {step === 'welcome' ? (
        <View style={styles.facts}>
          {WELCOME_FACTS.map((fact) => (
            <View key={fact.key} style={styles.fact}>
              <IconTile color={toneColor(fact.tone)} icon={fact.icon} />
              <View style={styles.factText}>
                <Text variant="metaStrong">{t(`onboarding.firstRun.facts.${fact.key}.title`)}</Text>
                <Text tone="muted" variant="meta">{t(`onboarding.firstRun.facts.${fact.key}.description`)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {step === 'goals' ? (
        <View style={styles.goals}>
          <View style={styles.options}>
            {GOAL_OPTIONS.map((goal) => {
              const selected = goals.includes(goal)
              const disabled = !selected && goals.length >= MAX_GOALS
              const label = t(`onboarding.firstRun.goals.options.${goal}`)
              return (
                <Pressable
                  key={goal}
                  accessibilityLabel={label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  onPress={() => toggleGoal(goal)}
                  style={({ pressed }) => [
                    styles.option,
                    { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primaryWash : palette.card },
                    disabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <IconTile color={toneColor(GOAL_ICONS[goal].tone)} icon={GOAL_ICONS[goal].icon} />
                  <View style={styles.factText}>
                    <Text variant="metaStrong">{label}</Text>
                    <Text tone="muted" variant="label">{t(`onboarding.firstRun.goals.helpers.${goal}`)}</Text>
                  </View>
                  <View style={[styles.checkbox, { borderColor: selected ? palette.primary : palette.input, backgroundColor: selected ? palette.primary : 'transparent' }]}>
                    {selected ? <Icon color={palette.primaryForeground} name="check" size={14} weight="bold" /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
          <View style={styles.hint}>
            <Icon color={palette.mutedForeground} name="info" />
            <Text tone="muted" variant="label">{t('onboarding.firstRun.goals.maxSelected')}</Text>
          </View>
        </View>
      ) : null}

      {step === 'privacy' ? (
        <View style={styles.facts}>
          {(['readOnly', 'bankAuth', 'revoke'] as const).map((item) => (
            <View key={item} style={styles.fact}>
              <IconTile color={palette.mutedForeground} icon={item === 'readOnly' ? 'shield-check' : item === 'bankAuth' ? 'landmark' : 'x'} />
              <Text style={styles.factText} variant="meta">{t(`onboarding.firstRun.privacy.points.${item}`)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {accountStep ? (
        <Button
          accessibilityLabel={t('onboarding.firstRun.account.manualCta')}
          block
          disabled={pending || !view.createAccountActionAvailable}
          label={t('onboarding.firstRun.account.manualCta')}
          onPress={() => void onCreateAccount()}
          variant="outline"
        />
      ) : null}
    </View></ScrollView>

    <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.background }]}>
      {index > 0 ? (
        <Pressable accessibilityLabel={t('onboarding.firstRun.back')} accessibilityRole="button" hitSlop={4} onPress={back} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Icon color={palette.mutedForeground} name="arrow-left" />
          <Text tone="muted" variant="metaStrong">{t('onboarding.firstRun.back')}</Text>
        </Pressable>
      ) : null}
      <View style={styles.spacer} />
      {accountStep ? (
        <Button
          accessibilityLabel={t('onboarding.firstRun.account.cta')}
          disabled={pending || !view.primaryActionAvailable}
          label={t('onboarding.firstRun.account.cta')}
          onPress={() => void onConnectBank()}
        />
      ) : (
        <Button
          disabled={step === 'goals' && goals.length === 0}
          label={t(`onboarding.firstRun.${step}.cta`, { defaultValue: t('onboarding.firstRun.continue') })}
          onPress={next}
        />
      )}
    </View>
  </SafeAreaView>
}

/** Web `FirstRunIconTile`: a 36pt muted rounded tile with an 18pt glyph in the step's tone. */
function IconTile({ icon, color }: { icon: IconName; color: string }) {
  const palette = usePalette()
  return (
    <View style={[styles.tile, { backgroundColor: palette.muted }]}>
      <Icon color={color} name={icon} size={18} />
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: themeTokens.layout.screenPadding,
    borderBottomWidth: 1,
  },
  logo: { width: 87, height: 32 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingTop: themeTokens.spacing[6] },
  page: { width: '100%', maxWidth: 672, alignSelf: 'center', gap: themeTokens.spacing[6] },
  progress: { gap: themeTokens.spacing[2] },
  segmentRail: { flexDirection: 'row', gap: themeTokens.spacing[1] },
  segment: { flex: 1, height: 2 },
  progressText: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[4] },
  stepLabel: { fontWeight: '500' },
  intro: { gap: themeTokens.spacing[2] },
  facts: { gap: themeTokens.spacing[4] },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[3] },
  factText: { flex: 1, minWidth: 0, gap: 2 },
  tile: { width: 36, height: 36, borderRadius: themeTokens.radius.lg, alignItems: 'center', justifyContent: 'center' },
  goals: { gap: themeTokens.spacing[3] },
  options: { gap: themeTokens.spacing[2] },
  option: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[2],
  },
  checkbox: { width: 20, height: 20, borderRadius: themeTokens.radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  footer: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    paddingHorizontal: themeTokens.layout.screenPadding,
    paddingVertical: themeTokens.spacing[2],
    borderTopWidth: 1,
  },
  back: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], paddingHorizontal: themeTokens.spacing[3] },
  spacer: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  skeleton: { maxWidth: '100%', borderRadius: themeTokens.radius.sm },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  failure: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
})
