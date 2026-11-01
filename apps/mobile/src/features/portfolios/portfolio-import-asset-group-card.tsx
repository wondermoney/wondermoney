import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioImportAssetGroupDto, PortfolioImportAssetGroupResolution } from './portfolio-import-contract'
import { PortfolioButton, type PortfolioPalette } from './portfolio-form-parts'
import { PortfolioTickerSearchField } from './portfolio-ticker-search-field'

export type PortfolioImportAssetGroupCardProps = Readonly<{
  group: PortfolioImportAssetGroupDto
  palette: PortfolioPalette
  resolution: PortfolioImportAssetGroupResolution | null
  onResolve: (resolution: PortfolioImportAssetGroupResolution) => void
  disabled?: boolean
}>

/**
 * One ambiguous/unmatched asset group from a CSV import: the raw name/symbol the file
 * carried, any server-suggested candidates (accept one with a tap), a ticker search to map it to a
 * different security, or a skip. Resolution is held by the parent review step and only sent to the
 * server when the whole batch is submitted.
 */
export function PortfolioImportAssetGroupCard({ group, palette, resolution, onResolve, disabled = false }: PortfolioImportAssetGroupCardProps) {
  const { t } = useTranslation()
  const label = group.rawAssetName ?? group.rawSymbol ?? t('portfolioImport.assetReview.unknownAsset')

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{label}</Text>
        <Text style={[styles.rowCount, { color: palette.mutedForeground }]}>
          {t('portfolioImport.assetReview.rowCount', { count: group.rowCount })}
        </Text>
      </View>

      {resolution ? (
        <View style={[styles.resolved, { borderColor: palette.primary, backgroundColor: palette.primarySoft }]}>
          <Text accessible accessibilityLabel={describeResolution(resolution, t)} style={[styles.resolvedText, { color: palette.foreground }]}>
            {describeResolution(resolution, t)}
          </Text>
          <PortfolioButton label={t('portfolioImport.assetReview.change')} onPress={() => onResolve(resolution)} palette={palette} secondary disabled={disabled} />
        </View>
      ) : (
        <View style={styles.body}>
          {group.candidates.length > 0 ? (
            <View style={styles.candidates}>
              <Text style={[styles.subheading, { color: palette.foreground }]}>{t('portfolioImport.assetReview.candidatesTitle')}</Text>
              {group.candidates.map((candidate) => (
                <PortfolioButton
                  key={`${candidate.financialAssetId}-${candidate.symbol}`}
                  label={[candidate.symbol, candidate.name, candidate.exchange].filter(Boolean).join(' · ')}
                  onPress={() => onResolve({ financialAssetId: candidate.financialAssetId, type: 'match' })}
                  palette={palette}
                  secondary
                  disabled={disabled}
                />
              ))}
            </View>
          ) : null}

          <PortfolioTickerSearchField
            label={t('portfolioImport.assetReview.searchLabel')}
            palette={palette}
            disabled={disabled}
            onSelect={(result) => onResolve({ symbol: result.symbol, type: 'external_symbol' })}
          />

          <PortfolioButton label={t('portfolioImport.assetReview.skip')} onPress={() => onResolve({ type: 'skip' })} palette={palette} secondary disabled={disabled} />
        </View>
      )}
    </View>
  )
}

function describeResolution(resolution: PortfolioImportAssetGroupResolution, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (resolution.type === 'skip') return t('portfolioImport.assetReview.resolvedSkipped')
  if (resolution.type === 'match') return t('portfolioImport.assetReview.resolvedAsMatch')
  return t('portfolioImport.assetReview.resolvedAs', { symbol: resolution.symbol })
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  heading: { gap: themeTokens.spacing[1] },
  title: { ...textStyles.action },
  rowCount: { ...textStyles.meta },
  subheading: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  body: { gap: themeTokens.spacing[3] },
  candidates: { gap: themeTokens.spacing[2] },
  resolved: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
  resolvedText: { ...textStyles.bodyStrong, fontWeight: '600' as const, flex: 1, minWidth: 160 },
})
