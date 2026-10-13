import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { PortfolioButton, PortfolioField, PortfolioToggle } from './portfolio-form-parts'
import type { PortfolioSettingsReconciliation } from './portfolio-settings-reconciliation'
import {
  PORTFOLIO_ALLOCATION_PRESETS,
  PORTFOLIO_TARGET_ASSET_CLASSES,
  PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS,
  portfolioSettingsWriteSchema,
  portfolioTargetAllocationsEqual,
  type PortfolioSettingsWrite,
  type PortfolioTargetAssetClass,
} from './portfolios-contract'
import type { PortfolioSettingsFailure } from './use-portfolio-settings'

export type PortfolioSettingsModel = Readonly<{ id: number; name: string; description: string | null; currency: string; benchmarkSymbol: string | null; excluded: boolean; favored: boolean; targetAllocation: Readonly<Record<string, number>> | null }>

function allocationInputsFrom(source: Readonly<Record<string, number>> | null | undefined): Record<PortfolioTargetAssetClass, string> {
  return Object.fromEntries(
    PORTFOLIO_TARGET_ASSET_CLASSES.map((key) => [key, source?.[key] !== undefined ? String(source[key]) : '']),
  ) as Record<PortfolioTargetAssetClass, string>
}

type PortfolioSettingsScreenProps = {
  model: PortfolioSettingsModel
  pending: boolean
  failure: PortfolioSettingsFailure | null
  unknownPayload: Readonly<PortfolioSettingsWrite> | null
  reconciling: boolean
  reconciliation: PortfolioSettingsReconciliation | null
  onBack: () => void
  onSave: (value: PortfolioSettingsWrite) => Promise<void>
  onReconcile: () => Promise<void>
  onAcknowledgeReconciliation: () => void
  onDismissApplied: () => void
}

export function PortfolioSettingsScreen({
  model,
  pending,
  failure,
  unknownPayload,
  reconciling,
  reconciliation,
  onBack,
  onSave,
  onReconcile,
  onAcknowledgeReconciliation,
  onDismissApplied,
}: PortfolioSettingsScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [name, setName] = useState(unknownPayload?.name ?? model.name)
  const [description, setDescription] = useState(unknownPayload && 'description' in unknownPayload ? unknownPayload.description ?? '' : model.description ?? '')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(unknownPayload && 'benchmarkSymbol' in unknownPayload ? unknownPayload.benchmarkSymbol ?? '' : model.benchmarkSymbol ?? '')
  const [excluded, setExcluded] = useState(unknownPayload?.excluded ?? model.excluded)
  const [favored, setFavored] = useState(unknownPayload?.favored ?? model.favored)
  const [allocationInputs, setAllocationInputs] = useState<Record<PortfolioTargetAssetClass, string>>(() => (
    allocationInputsFrom(unknownPayload && 'targetAllocation' in unknownPayload ? unknownPayload.targetAllocation : model.targetAllocation)
  ))
  const [reviewed, setReviewed] = useState<Readonly<PortfolioSettingsWrite> | null>(null)
  const [validation, setValidation] = useState(false)
  const blocked = unknownPayload !== null

  const allocationHasEntries = PORTFOLIO_TARGET_ASSET_CLASSES.some((key) => allocationInputs[key].trim().length > 0)
  const allocationTotal = PORTFOLIO_TARGET_ASSET_CLASSES.reduce((sum, key) => {
    const parsed = Number(allocationInputs[key].trim())
    return sum + (Number.isFinite(parsed) ? parsed : 0)
  }, 0)

  const applyAllocationPreset = (preset: keyof typeof PORTFOLIO_ALLOCATION_PRESETS) => {
    setAllocationInputs(allocationInputsFrom(PORTFOLIO_ALLOCATION_PRESETS[preset]))
    setValidation(false)
  }
  const clearAllocation = () => {
    setAllocationInputs(allocationInputsFrom(null))
    setValidation(false)
  }

  useEffect(() => {
    if (!pending) return
    const listener = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => listener.remove()
  }, [pending])

  const buildReview = () => {
    const nextName = name.trim()
    const nextDescription = description.trim().length === 0 ? null : description
    const nextBenchmarkSymbol = benchmarkSymbol.trim().length === 0 ? null : benchmarkSymbol.trim()
    const allocationEntries = PORTFOLIO_TARGET_ASSET_CLASSES
      .map((key) => [key, allocationInputs[key].trim()] as const)
      .filter(([, raw]) => raw.length > 0)
    const nextAllocation = allocationEntries.length === 0
      ? null
      : Object.fromEntries(allocationEntries.map(([key, raw]) => [key, Number(raw)]))
    const candidate = {
      ...(nextName !== model.name ? { name: nextName } : {}),
      ...(nextDescription !== model.description ? { description: nextDescription } : {}),
      ...(nextBenchmarkSymbol !== model.benchmarkSymbol ? { benchmarkSymbol: nextBenchmarkSymbol } : {}),
      ...(excluded !== model.excluded ? { excluded } : {}),
      ...(favored !== model.favored ? { favored } : {}),
      ...(!portfolioTargetAllocationsEqual(nextAllocation, model.targetAllocation) ? { targetAllocation: nextAllocation } : {}),
    }
    const parsed = portfolioSettingsWriteSchema.safeParse(candidate)
    if (!parsed.success) {
      setValidation(true)
      return
    }
    setValidation(false)
    setReviewed(Object.freeze(parsed.data))
  }

  const editReview = () => setReviewed(null)
  const cancelReview = () => {
    setName(model.name)
    setDescription(model.description ?? '')
    setBenchmarkSymbol(model.benchmarkSymbol ?? '')
    setExcluded(model.excluded)
    setFavored(model.favored)
    setAllocationInputs(allocationInputsFrom(model.targetAllocation))
    setValidation(false)
    setReviewed(null)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/portfolio" label={t('portfolioSettings.back')} onPress={onBack} disabled={pending} />
            <View style={styles.heading}>
              <PageHeader palette={palette}
            instruction={t('portfolioSettings.helper')} title={t('portfolioSettings.title')} />
            </View>
          </View>

          <View style={[styles.identity, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text style={[styles.name, { color: palette.foreground }]}>{model.name}</Text>
            <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.currencyLocked', { currency: model.currency })}</Text>
          </View>

          {reconciliation === 'applied' && !blocked ? (
            <View style={[styles.notice, { borderColor: palette.primary, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioSettings.appliedTitle')}</Text>
              <Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.appliedMessage')}</Text>
              <View style={styles.actions}><PortfolioButton label={t('portfolioSettings.continue')} onPress={onDismissApplied} palette={palette} /></View>
            </View>
          ) : null}

          {blocked ? (
            <View style={[styles.notice, { borderColor: palette.destructive, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioSettings.unknownTitle')}</Text>
              <Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.unknownMessage')}</Text>
              <ReviewChanges payload={unknownPayload} palette={palette} />
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>
                {reconciling
                  ? t('portfolioSettings.reconciling')
                  : reconciliation === 'not-applied'
                    ? t('portfolioSettings.notAppliedMessage')
                    : reconciliation === 'uncertain'
                      ? t('portfolioSettings.reconciliationFailed')
                      : t('portfolioSettings.reconcileRequired')}
              </Text>
              <View style={styles.actions}>
                <BackControl fallback="/portfolio" label={t('portfolioSettings.back')} onPress={onBack} />
                {reconciliation === 'not-applied'
                  ? <PortfolioButton label={t('portfolioSettings.acknowledge')} onPress={onAcknowledgeReconciliation} palette={palette} />
                  : <PortfolioButton label={t('portfolioSettings.refresh')} onPress={onReconcile} palette={palette} disabled={reconciling} busy={reconciling} />}
              </View>
            </View>
          ) : reviewed ? (
            <View style={styles.form}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioSettings.reviewTitle')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.reviewHelper')}</Text>
              <ReviewChanges payload={reviewed} palette={palette} />
              {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t(`portfolioSettings.failures.${failure}`)}</Text> : null}
              <View style={styles.actions}>
                <PortfolioButton label={t('portfolioSettings.cancelReview')} onPress={cancelReview} palette={palette} secondary disabled={pending} />
                <PortfolioButton label={t('portfolioSettings.edit')} onPress={editReview} palette={palette} secondary disabled={pending} />
                <PortfolioButton label={pending ? t('portfolioSettings.saving') : t('portfolioSettings.confirm')} onPress={() => onSave(reviewed)} palette={palette} disabled={pending} busy={pending} />
              </View>
            </View>
          ) : (
            <View style={styles.form}>
              <PortfolioField label={t('portfolioSettings.name')} value={name} onChange={(value) => { setName(value); setValidation(false) }} maxLength={255} palette={palette} required disabled={pending} />
              <PortfolioField label={t('portfolioSettings.description')} value={description} onChange={(value) => { setDescription(value); setValidation(false) }} maxLength={500} palette={palette} multiline disabled={pending} />
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.blankDescription')}</Text>
              <PortfolioField label={t('portfolioSettings.benchmarkSymbol')} value={benchmarkSymbol} onChange={(value) => { setBenchmarkSymbol(value); setValidation(false) }} maxLength={20} palette={palette} disabled={pending} />
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.blankBenchmark')}</Text>
              <PortfolioToggle label={t('portfolioSettings.excluded')} helper={t('portfolioSettings.excludedHelper')} value={excluded} onToggle={(next) => { setExcluded(next); setValidation(false) }} palette={palette} disabled={pending} />
              <PortfolioToggle label={t('portfolioSettings.favored')} helper={t('portfolioSettings.favoredHelper')} value={favored} onToggle={(next) => { setFavored(next); setValidation(false) }} palette={palette} disabled={pending} />

              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioSettings.allocation.heading')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioSettings.allocation.helper')}</Text>
              <View style={styles.actions}>
                <PortfolioButton label={t('portfolioSettings.allocation.presets.conservative')} onPress={() => applyAllocationPreset('conservative')} palette={palette} secondary disabled={pending} />
                <PortfolioButton label={t('portfolioSettings.allocation.presets.balanced')} onPress={() => applyAllocationPreset('balanced')} palette={palette} secondary disabled={pending} />
                <PortfolioButton label={t('portfolioSettings.allocation.presets.growth')} onPress={() => applyAllocationPreset('growth')} palette={palette} secondary disabled={pending} />
                <PortfolioButton label={t('portfolioSettings.allocation.clear')} onPress={clearAllocation} palette={palette} secondary disabled={pending || !allocationHasEntries} />
              </View>
              {PORTFOLIO_TARGET_ASSET_CLASSES.map((key) => (
                <PortfolioField
                  key={key}
                  label={t(`portfolioSettings.allocation.classes.${PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS[key]}`)}
                  value={allocationInputs[key]}
                  onChange={(value) => { setAllocationInputs((prev) => ({ ...prev, [key]: value })); setValidation(false) }}
                  maxLength={6}
                  palette={palette}
                  disabled={pending}
                  keyboardType="decimal-pad"
                />
              ))}
              <Text style={[styles.helper, { color: allocationHasEntries && allocationTotal !== 100 ? palette.destructive : palette.mutedForeground }]}>
                {t('portfolioSettings.allocation.total', { total: allocationTotal })}
              </Text>

              {validation ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t('portfolioSettings.validation')}</Text> : null}
              {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t(`portfolioSettings.failures.${failure}`)}</Text> : null}
              <PortfolioButton label={t('portfolioSettings.review')} onPress={buildReview} palette={palette} disabled={pending} />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReviewChanges({ payload, palette }: { payload: Readonly<PortfolioSettingsWrite>; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) {
  const { t } = useTranslation()
  return (
    <View style={[styles.reviewCard, { borderColor: palette.border, backgroundColor: palette.card }]}>
      {payload.name !== undefined ? <ReviewRow label={t('portfolioSettings.name')} value={payload.name} palette={palette} /> : null}
      {payload.description !== undefined ? <ReviewRow label={t('portfolioSettings.description')} value={payload.description === null ? t('portfolioSettings.descriptionCleared') : payload.description} palette={palette} /> : null}
      {payload.benchmarkSymbol !== undefined ? <ReviewRow label={t('portfolioSettings.benchmarkSymbol')} value={payload.benchmarkSymbol === null ? t('portfolioSettings.benchmarkCleared') : payload.benchmarkSymbol} palette={palette} /> : null}
      {payload.excluded !== undefined ? <ReviewRow label={t('portfolioSettings.excluded')} value={t(payload.excluded ? 'portfolioSettings.on' : 'portfolioSettings.off')} palette={palette} /> : null}
      {payload.favored !== undefined ? <ReviewRow label={t('portfolioSettings.favored')} value={t(payload.favored ? 'portfolioSettings.on' : 'portfolioSettings.off')} palette={palette} /> : null}
      {payload.targetAllocation !== undefined ? (
        payload.targetAllocation === null
          ? <ReviewRow label={t('portfolioSettings.allocation.heading')} value={t('portfolioSettings.allocation.cleared')} palette={palette} />
          : PORTFOLIO_TARGET_ASSET_CLASSES
            .filter((key) => payload.targetAllocation![key] !== undefined)
            .map((key) => (
              <ReviewRow
                key={key}
                label={t(`portfolioSettings.allocation.classes.${PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS[key]}`)}
                value={t('portfolioSettings.allocation.percent', { value: payload.targetAllocation![key] })}
                palette={palette}
              />
            ))
      ) : null}
    </View>
  )
}

function ReviewRow({ label, value, palette }: { label: string; value: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) {
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.reviewRow}><Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.reviewValue, { color: palette.foreground }]}>{value}</Text></View>
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] },
  helper: { ...textStyles.body },
  identity: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] },
  name: { ...textStyles.section },
  form: { gap: themeTokens.spacing[4] },
  alert: { ...textStyles.body },
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  sectionTitle: { ...textStyles.section },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  reviewCard: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  reviewRow: { gap: themeTokens.spacing[1] },
  reviewValue: { ...textStyles.action },
})
