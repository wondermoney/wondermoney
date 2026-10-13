import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { PortfolioImportAssetReviewStep } from './portfolio-import-asset-review-step'
import { PortfolioButton, type PortfolioPalette } from './portfolio-form-parts'
import type { PortfolioImportAssetGroupMapping, PortfolioImportPhase } from './use-portfolio-import'

export type PortfolioImportScreenProps = Readonly<{
  state: PortfolioImportPhase
  onPickFile: () => void | Promise<void>
  onConfirm: () => void | Promise<void>
  onReset: () => void
  onBack: () => void
  onResolveAssetGroups: (mappings: readonly PortfolioImportAssetGroupMapping[]) => void | Promise<void>
  resolvingAssetGroups: boolean
  palette: PortfolioPalette
}>

const IN_PROGRESS_PHASES: ReadonlySet<PortfolioImportPhase['phase']> = new Set(['uploading', 'parsing', 'mapping', 'confirming'])

export function PortfolioImportScreen({ state, onPickFile, onConfirm, onReset, onBack, onResolveAssetGroups, resolvingAssetGroups, palette }: PortfolioImportScreenProps) {
  const { t } = useTranslation()
  const busy = IN_PROGRESS_PHASES.has(state.phase)
  const reviewGroups = state.phase === 'review' ? state.preview.assetGroups.filter((group) => group.status !== 'matched') : []

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/portfolio" label={t('portfolioImport.back')} onPress={onBack} disabled={busy} />
            <View style={styles.heading}>
              <PageHeader palette={palette}
            instruction={t('portfolioImport.helper')} title={t('portfolioImport.title')} />
            </View>
          </View>

          {state.phase === 'idle' ? (
            <PortfolioButton label={t('portfolioImport.chooseFile')} onPress={onPickFile} palette={palette} />
          ) : null}

          {busy ? (
            <Text accessibilityRole="progressbar" accessibilityLabel={t(`portfolioImport.phases.${state.phase}`)} style={[styles.helper, { color: palette.mutedForeground }]}>
              {t(`portfolioImport.phases.${state.phase}`)}
            </Text>
          ) : null}

          {state.phase === 'review' ? (
            <View style={styles.form}>
              <ImportSummary summary={state.preview.summary} palette={palette} />
              {reviewGroups.length > 0 ? (
                <PortfolioImportAssetReviewStep
                  groups={reviewGroups}
                  palette={palette}
                  busy={resolvingAssetGroups}
                  onSubmit={onResolveAssetGroups}
                />
              ) : !state.preview.summary.canConfirm ? (
                <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>
                  {t(state.preview.summary.needsAssetReviewRows > 0 ? 'portfolioImport.needsAssetReview' : 'portfolioImport.nothingToImport')}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <PortfolioButton label={t('portfolioImport.startOver')} onPress={onReset} palette={palette} secondary disabled={resolvingAssetGroups} />
                <PortfolioButton label={t('portfolioImport.confirm')} onPress={onConfirm} palette={palette} disabled={!state.preview.summary.canConfirm || resolvingAssetGroups} />
              </View>
            </View>
          ) : null}

          {state.phase === 'succeeded' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.success, { color: palette.foreground }]}>
                {t('portfolioImport.succeeded', { count: state.preview.summary.importedRows || state.preview.summary.readyRows })}
              </Text>
              <PortfolioButton label={t('portfolioImport.done')} onPress={onBack} palette={palette} />
            </View>
          ) : null}

          {state.phase === 'failed' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>
                {t(`portfolioImport.failures.${state.reason}`)}
              </Text>
              <PortfolioButton label={t('portfolioImport.tryAgain')} onPress={onReset} palette={palette} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ImportSummary({ summary, palette }: { summary: { readyRows: number; duplicateRows: number; invalidRows: number; needsAssetReviewRows: number; totalRows: number }; palette: PortfolioPalette }) {
  const { t } = useTranslation()
  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioImport.reviewTitle')}</Text>
      <SummaryRow label={t('portfolioImport.readyRows')} value={summary.readyRows} palette={palette} />
      <SummaryRow label={t('portfolioImport.duplicateRows')} value={summary.duplicateRows} palette={palette} />
      <SummaryRow label={t('portfolioImport.invalidRows')} value={summary.invalidRows} palette={palette} />
      <SummaryRow label={t('portfolioImport.needsAssetReviewRows')} value={summary.needsAssetReviewRows} palette={palette} />
    </View>
  )
}

function SummaryRow({ label, value, palette }: { label: string; value: number; palette: PortfolioPalette }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.summaryRow}>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] },
  helper: { ...textStyles.body },
  form: { gap: themeTokens.spacing[4] },
  card: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  sectionTitle: { ...textStyles.section },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryValue: { ...textStyles.amount },
  alert: { ...textStyles.body },
  success: { ...textStyles.action },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})
