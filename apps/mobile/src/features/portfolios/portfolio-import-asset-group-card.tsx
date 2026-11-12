import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { OptionSheet } from '@/components/ui/sheet'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import {
  assetGroupDetails,
  assetGroupTitle,
  type PortfolioImportAssetChoice,
  type PortfolioImportExistingAsset,
  selectableCandidates,
} from './portfolio-import-asset-review-view-model'
import type { PortfolioImportAssetGroupDto } from './portfolio-import-contract'
import { PortfolioButton, type PortfolioPalette } from './portfolio-form-parts'
import { PortfolioTickerSearchField } from './portfolio-ticker-search-field'

export type PortfolioImportAssetGroupCardProps = Readonly<{
  group: PortfolioImportAssetGroupDto
  existingAssets: readonly PortfolioImportExistingAsset[]
  palette: PortfolioPalette
  choice: PortfolioImportAssetChoice | null
  onChoose: (choice: PortfolioImportAssetChoice) => void
  onClear: () => void
  disabled?: boolean
}>

/**
 * One asset group from a CSV import that needs a decision: what the file called the asset, the
 * listings the provider found (pick one with a tap), a ticker search, a holding already in this
 * portfolio, or a skip. The choice is held by the review step and sent with the whole review.
 */
export function PortfolioImportAssetGroupCard({ group, existingAssets, palette, choice, onChoose, onClear, disabled = false }: PortfolioImportAssetGroupCardProps) {
  const { t } = useTranslation()
  const [pickingHolding, setPickingHolding] = useState(false)
  const title = assetGroupTitle(group) ?? t('portfolioImport.assetReview.unknownAsset')
  const details = assetGroupDetails(group)
  const candidates = selectableCandidates(group)
  const resolvedLabel = choice?.action === 'skip_group'
    ? t('portfolioImport.assetReview.resolvedSkipped')
    : choice ? t('portfolioImport.assetReview.resolvedAs', { symbol: choice.symbol }) : null

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{title}</Text>
        {details ? <Text style={[styles.details, { color: palette.mutedForeground }]}>{details}</Text> : null}
      </View>

      {resolvedLabel ? (
        <View style={[styles.resolved, { borderColor: palette.primary, backgroundColor: palette.primarySoft }]}>
          <Text accessible accessibilityLabel={resolvedLabel} style={[styles.resolvedText, { color: palette.foreground }]}>
            {resolvedLabel}
          </Text>
          <PortfolioButton label={t('portfolioImport.assetReview.change')} onPress={onClear} palette={palette} secondary disabled={disabled} />
        </View>
      ) : (
        <View style={styles.body}>
          {candidates.length > 0 ? (
            <View style={styles.candidates}>
              <Text style={[styles.subheading, { color: palette.foreground }]}>{t('portfolioImport.assetReview.candidatesTitle')}</Text>
              {candidates.map((candidate) => (
                <PortfolioButton
                  key={candidate.id}
                  label={[candidate.symbol, candidate.name, candidate.exchange].filter(Boolean).join(' · ')}
                  onPress={() => onChoose({ action: 'use_candidate', candidateId: candidate.id, symbol: candidate.symbol })}
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
            onSelect={(result) => onChoose({ action: 'use_external_symbol', symbol: result.symbol })}
          />

          {existingAssets.length > 0 ? (
            <PortfolioButton label={t('portfolioImport.assetReview.chooseHolding')} onPress={() => setPickingHolding(true)} palette={palette} secondary disabled={disabled} />
          ) : null}

          <PortfolioButton label={t('portfolioImport.assetReview.skip')} onPress={() => onChoose({ action: 'skip_group' })} palette={palette} secondary disabled={disabled} />
        </View>
      )}

      <OptionSheet
        visible={pickingHolding}
        title={t('portfolioImport.assetReview.holdingsTitle')}
        options={existingAssets.map((asset) => ({ value: asset.financialAssetId, label: asset.symbol, meta: asset.name }))}
        onClose={() => setPickingHolding(false)}
        onSelect={(financialAssetId) => {
          const asset = existingAssets.find((item) => item.financialAssetId === financialAssetId)
          if (asset) onChoose({ action: 'use_existing_asset', financialAssetId: asset.financialAssetId, symbol: asset.symbol })
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  heading: { gap: themeTokens.spacing[1] },
  title: { ...textStyles.action },
  details: { ...textStyles.meta },
  subheading: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  body: { gap: themeTokens.spacing[3] },
  candidates: { gap: themeTokens.spacing[2] },
  resolved: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] },
  resolvedText: { ...textStyles.bodyStrong, fontWeight: '600' as const, flex: 1, minWidth: 160 },
})
