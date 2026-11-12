import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { EntityMark, portfolioMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatNumberInput, parseNumberInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { linkRefusalMessage, linkSummary, PortfolioAccountLinkFields } from './portfolio-account-link-fields'
import {
  draftFromLink,
  linkChanged,
  linkInputFromDraft,
  NOT_LINKED_DRAFT,
  type LinkableAccount,
  type PortfolioAccountLink,
  type PortfolioAccountLinkDraft,
} from './portfolio-account-link'
import { PortfolioReviewList, PortfolioReviewRow } from './portfolio-form-parts'
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

export type PortfolioSettingsModel = Readonly<{ id: number; name: string; description: string | null; currency: string; benchmarkSymbol: string | null; excluded: boolean; favored: boolean; targetAllocation: Readonly<Record<string, number>> | null; accountLink: PortfolioAccountLink | null }>

/** The words for a failed save; a refused link names the member who holds it and nothing else. */
export function portfolioSettingsFailureMessage(t: TFunction, failure: PortfolioSettingsFailure, linkHolder: string | null): string {
  return linkRefusalMessage(t, failure, linkHolder) ?? t(`portfolioSettings.failures.${failure}`)
}

function allocationInputsFrom(source: Readonly<Record<string, number>> | null | undefined, locale: string): Record<PortfolioTargetAssetClass, string> {
  return Object.fromEntries(
    PORTFOLIO_TARGET_ASSET_CLASSES.map((key) => [key, source?.[key] !== undefined ? formatNumberInput(source[key], locale) : '']),
  ) as Record<PortfolioTargetAssetClass, string>
}

type PortfolioSettingsScreenProps = {
  model: PortfolioSettingsModel
  pending: boolean
  failure: PortfolioSettingsFailure | null
  /** Who holds the link, when the save was refused because the other member does. */
  linkHolder?: string | null
  /** The accounts this member can see, for the link picker; empty while they load. */
  accounts?: readonly LinkableAccount[]
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
  linkHolder = null,
  accounts = [],
  unknownPayload,
  reconciling,
  reconciliation,
  onBack,
  onSave,
  onReconcile,
  onAcknowledgeReconciliation,
  onDismissApplied,
}: PortfolioSettingsScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  // Percentages are read in the app's language ("12,5" in pt and es).
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState(unknownPayload?.name ?? model.name)
  const [description, setDescription] = useState(unknownPayload && 'description' in unknownPayload ? unknownPayload.description ?? '' : model.description ?? '')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(unknownPayload && 'benchmarkSymbol' in unknownPayload ? unknownPayload.benchmarkSymbol ?? '' : model.benchmarkSymbol ?? '')
  const [excluded, setExcluded] = useState(unknownPayload?.excluded ?? model.excluded)
  const [favored, setFavored] = useState(unknownPayload?.favored ?? model.favored)
  const [allocationInputs, setAllocationInputs] = useState<Record<PortfolioTargetAssetClass, string>>(() => (
    allocationInputsFrom(unknownPayload && 'targetAllocation' in unknownPayload ? unknownPayload.targetAllocation : model.targetAllocation, locale)
  ))
  const [link, setLink] = useState<PortfolioAccountLinkDraft>(() => (
    unknownPayload && unknownPayload.accountLink !== undefined
      ? unknownPayload.accountLink ?? NOT_LINKED_DRAFT
      : draftFromLink(model.accountLink)
  ))
  const [reviewed, setReviewed] = useState<Readonly<PortfolioSettingsWrite> | null>(null)
  const blocked = unknownPayload !== null

  const allocationHasEntries = PORTFOLIO_TARGET_ASSET_CLASSES.some((key) => allocationInputs[key].trim().length > 0)
  const allocationTotal = PORTFOLIO_TARGET_ASSET_CLASSES.reduce((sum, key) => {
    const parsed = parseNumberInput(allocationInputs[key], locale)
    return sum + (parsed ?? 0)
  }, 0)

  const applyAllocationPreset = (preset: keyof typeof PORTFOLIO_ALLOCATION_PRESETS) => {
    setAllocationInputs(allocationInputsFrom(PORTFOLIO_ALLOCATION_PRESETS[preset], locale))
  }
  const clearAllocation = () => {
    setAllocationInputs(allocationInputsFrom(null, locale))
  }

  useEffect(() => {
    if (!pending) return
    const listener = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => listener.remove()
  }, [pending])

  // The candidate is re-derived on every render: the ✓ stays disabled until
  // something changed and every change is valid.
  const nextName = name.trim()
  const nextDescription = description.trim().length === 0 ? null : description
  const nextBenchmarkSymbol = benchmarkSymbol.trim().length === 0 ? null : benchmarkSymbol.trim()
  const allocationEntries = PORTFOLIO_TARGET_ASSET_CLASSES
    .map((key) => [key, allocationInputs[key].trim()] as const)
    .filter(([, raw]) => raw.length > 0)
  const nextAllocation = allocationEntries.length === 0
    ? null
    : Object.fromEntries(allocationEntries.map(([key, raw]) => [key, parseNumberInput(raw, locale) ?? Number.NaN]))
  const candidate = {
    ...(nextName !== model.name ? { name: nextName } : {}),
    ...(nextDescription !== model.description ? { description: nextDescription } : {}),
    ...(nextBenchmarkSymbol !== model.benchmarkSymbol ? { benchmarkSymbol: nextBenchmarkSymbol } : {}),
    ...(excluded !== model.excluded ? { excluded } : {}),
    ...(favored !== model.favored ? { favored } : {}),
    ...(!portfolioTargetAllocationsEqual(nextAllocation, model.targetAllocation) ? { targetAllocation: nextAllocation } : {}),
    // Sent only when changed: a link this member cannot see is never touched.
    ...(linkChanged(model.accountLink, link) ? { accountLink: linkInputFromDraft(link) } : {}),
  }
  const parsed = portfolioSettingsWriteSchema.safeParse(candidate)
  const invalidAllocation = (key: PortfolioTargetAssetClass) => {
    const raw = allocationInputs[key].trim()
    const value = parseNumberInput(raw, locale)
    return raw.length > 0 && !(value !== null && value >= 0)
  }
  const nameError = nextName.length === 0 ? t('portfolioSettings.nameError') : null

  const buildReview = () => {
    if (!parsed.success) return
    setReviewed(Object.freeze(parsed.data))
  }

  const editReview = () => setReviewed(null)
  const cancelReview = () => {
    setName(model.name)
    setDescription(model.description ?? '')
    setBenchmarkSymbol(model.benchmarkSymbol ?? '')
    setExcluded(model.excluded)
    setFavored(model.favored)
    setAllocationInputs(allocationInputsFrom(model.targetAllocation, locale))
    setLink(draftFromLink(model.accountLink))
    setReviewed(null)
  }
  const failureMessage = failure ? portfolioSettingsFailureMessage(t, failure, linkHolder) : null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={blocked ? undefined : reviewed ? () => void onSave(reviewed) : buildReview}
        saveDisabled={reviewed ? pending : !parsed.success || pending}
        saveLabel={reviewed ? (pending ? t('portfolioSettings.saving') : t('portfolioSettings.confirm')) : t('portfolioSettings.review')}
        saving={reviewed !== null && pending}
        title={t('portfolioSettings.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.identity}>
            <EntityMark {...portfolioMark()} />
            <View style={styles.identityText}>
              <Text variant="bodyStrong">{model.name}</Text>
              <Text tone="muted" variant="meta">{t('portfolioSettings.currencyLocked', { currency: model.currency })}</Text>
            </View>
          </View>

          {reconciliation === 'applied' && !blocked ? (
            <Notice
              action={<Button label={t('portfolioSettings.continue')} onPress={onDismissApplied} size="sm" />}
              message={t('portfolioSettings.appliedMessage')}
              title={t('portfolioSettings.appliedTitle')}
            />
          ) : null}

          {blocked ? (
            <View style={styles.form}>
              <Notice message={t('portfolioSettings.unknownMessage')} title={t('portfolioSettings.unknownTitle')} tone="destructive" />
              <ReviewChanges accounts={accounts} linkedAccountName={model.accountLink?.accountName} payload={unknownPayload} />
              <Text tone="muted" variant="meta">
                {reconciling
                  ? t('portfolioSettings.reconciling')
                  : reconciliation === 'not-applied'
                    ? t('portfolioSettings.notAppliedMessage')
                    : reconciliation === 'uncertain'
                      ? t('portfolioSettings.reconciliationFailed')
                      : t('portfolioSettings.reconcileRequired')}
              </Text>
              <View style={styles.actions}>
                <Button label={t('portfolioSettings.back')} onPress={onBack} variant="secondary" />
                {reconciliation === 'not-applied'
                  ? <Button label={t('portfolioSettings.acknowledge')} onPress={onAcknowledgeReconciliation} />
                  : <Button disabled={reconciling} label={t('portfolioSettings.refresh')} loading={reconciling} onPress={() => void onReconcile()} />}
              </View>
            </View>
          ) : reviewed ? (
            <View style={styles.form}>
              <View style={styles.head}>
                <Text accessibilityRole="header" variant="heading">{t('portfolioSettings.reviewTitle')}</Text>
                <Text tone="muted" variant="meta">{t('portfolioSettings.reviewHelper')}</Text>
              </View>
              <ReviewChanges accounts={accounts} linkedAccountName={model.accountLink?.accountName} payload={reviewed} />
              {failureMessage ? <Notice message={failureMessage} tone="destructive" /> : null}
              <View style={styles.actions}>
                <Button disabled={pending} label={t('portfolioSettings.cancelReview')} onPress={cancelReview} variant="secondary" />
                <Button disabled={pending} label={t('portfolioSettings.edit')} onPress={editReview} variant="secondary" />
              </View>
            </View>
          ) : (
            <View style={styles.form}>
              <FormGroup>
                <FormTextRow key="name" editable={!pending} error={nameError} label={t('portfolioSettings.name')} maxLength={255} onChangeText={setName} value={name} />
                <FormTextRow key="description" editable={!pending} hint={t('portfolioSettings.blankDescription')} label={t('portfolioSettings.description')} maxLength={500} multiline onChangeText={setDescription} value={description} />
                <FormTextRow key="benchmark" autoCapitalize="characters" autoCorrect={false} editable={!pending} hint={t('portfolioSettings.blankBenchmark')} label={t('portfolioSettings.benchmarkSymbol')} maxLength={20} onChangeText={setBenchmarkSymbol} placeholder={t('portfolioTickerSearch.placeholder')} value={benchmarkSymbol} />
                <FormSwitchRow key="excluded" disabled={pending} hint={t('portfolioSettings.excludedHelper')} label={t('portfolioSettings.excluded')} onValueChange={setExcluded} value={excluded} />
                <FormSwitchRow key="favored" disabled={pending} hint={t('portfolioSettings.favoredHelper')} label={t('portfolioSettings.favored')} onValueChange={setFavored} value={favored} />
              </FormGroup>

              <PortfolioAccountLinkFields accounts={accounts} disabled={pending} linkedAccountName={model.accountLink?.accountName} onChange={setLink} testID="portfolio-settings-account-link" value={link} />

              <View style={styles.section}>
                <View style={styles.head}>
                  <Text accessibilityRole="header" variant="heading">{t('portfolioSettings.allocation.heading')}</Text>
                  <Text tone="muted" variant="meta">{t('portfolioSettings.allocation.helper')}</Text>
                </View>
                <View style={styles.actions}>
                  <Button disabled={pending} label={t('portfolioSettings.allocation.presets.conservative')} onPress={() => applyAllocationPreset('conservative')} size="sm" variant="secondary" />
                  <Button disabled={pending} label={t('portfolioSettings.allocation.presets.balanced')} onPress={() => applyAllocationPreset('balanced')} size="sm" variant="secondary" />
                  <Button disabled={pending} label={t('portfolioSettings.allocation.presets.growth')} onPress={() => applyAllocationPreset('growth')} size="sm" variant="secondary" />
                  <Button disabled={pending || !allocationHasEntries} label={t('portfolioSettings.allocation.clear')} onPress={clearAllocation} size="sm" variant="ghost" />
                </View>
                <FormGroup>
                  {PORTFOLIO_TARGET_ASSET_CLASSES.map((key) => (
                    <FormTextRow
                      key={key}
                      editable={!pending}
                      error={invalidAllocation(key) ? t('portfolioSettings.allocation.invalid') : null}
                      keyboardType="decimal-pad"
                      label={t(`portfolioSettings.allocation.classes.${PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS[key]}`)}
                      maxLength={6}
                      onChangeText={(value) => setAllocationInputs((prev) => ({ ...prev, [key]: value }))}
                      placeholder="0"
                      value={allocationInputs[key]}
                    />
                  ))}
                </FormGroup>
                <Text tone="muted" variant="meta">{t('portfolioSettings.allocation.total', { total: allocationTotal })}</Text>
              </View>

              {failureMessage ? <Notice message={failureMessage} tone="destructive" /> : null}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReviewChanges({ payload, accounts, linkedAccountName }: { payload: Readonly<PortfolioSettingsWrite>; accounts: readonly LinkableAccount[]; linkedAccountName?: string | null }) {
  const { t } = useTranslation()
  return (
    <PortfolioReviewList>
      {payload.name !== undefined ? <PortfolioReviewRow key="name" label={t('portfolioSettings.name')} value={payload.name} /> : null}
      {payload.description !== undefined ? <PortfolioReviewRow key="description" label={t('portfolioSettings.description')} value={payload.description === null ? t('portfolioSettings.descriptionCleared') : payload.description} /> : null}
      {payload.benchmarkSymbol !== undefined ? <PortfolioReviewRow key="benchmark" label={t('portfolioSettings.benchmarkSymbol')} value={payload.benchmarkSymbol === null ? t('portfolioSettings.benchmarkCleared') : payload.benchmarkSymbol} /> : null}
      {payload.excluded !== undefined ? <PortfolioReviewRow key="excluded" label={t('portfolioSettings.excluded')} value={t(payload.excluded ? 'portfolioSettings.on' : 'portfolioSettings.off')} /> : null}
      {payload.favored !== undefined ? <PortfolioReviewRow key="favored" label={t('portfolioSettings.favored')} value={t(payload.favored ? 'portfolioSettings.on' : 'portfolioSettings.off')} /> : null}
      {payload.accountLink !== undefined ? <PortfolioReviewRow key="account-link" label={t('portfolioAccountLink.accountLabel')} value={linkSummary(t, payload.accountLink, accounts, linkedAccountName)} /> : null}
      {payload.targetAllocation !== undefined ? (
        payload.targetAllocation === null
          ? <PortfolioReviewRow key="allocation" label={t('portfolioSettings.allocation.heading')} value={t('portfolioSettings.allocation.cleared')} />
          : PORTFOLIO_TARGET_ASSET_CLASSES
            .filter((key) => payload.targetAllocation![key] !== undefined)
            .map((key) => (
              <PortfolioReviewRow
                key={key}
                label={t(`portfolioSettings.allocation.classes.${PORTFOLIO_TARGET_ASSET_CLASS_I18N_KEYS[key]}`)}
                value={t('portfolioSettings.allocation.percent', { value: payload.targetAllocation![key] })}
              />
            ))
      ) : null}
    </PortfolioReviewList>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[6], paddingTop: themeTokens.spacing[2] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  identityText: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  form: { gap: themeTokens.spacing[4] },
  head: { gap: themeTokens.spacing[2] },
  section: { gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[6] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
