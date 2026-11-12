import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { PortfolioImportAssetGroupCard } from './portfolio-import-asset-group-card'
import {
  decisionForChoice,
  type PortfolioImportAssetChoice,
  type PortfolioImportExistingAsset,
  recommendedChoices,
} from './portfolio-import-asset-review-view-model'
import type { PortfolioImportAssetGroupDto, PortfolioImportAssetMappingDecision } from './portfolio-import-contract'
import { PortfolioButton, type PortfolioPalette } from './portfolio-form-parts'

export type PortfolioImportAssetReviewStepProps = Readonly<{
  /** The groups that need a decision (`groupsNeedingReview`). */
  groups: readonly PortfolioImportAssetGroupDto[]
  existingAssets: readonly PortfolioImportExistingAsset[]
  palette: PortfolioPalette
  busy: boolean
  onSubmit: (decisions: readonly PortfolioImportAssetMappingDecision[]) => void | Promise<void>
}>

/**
 * The asset-matching step web calls PortfolioImportAssetReviewStep: one card per ambiguous,
 * unmatched or provider-error group, with the server's recommended listing pre-selected. Choices
 * stay on the device until every group has one, then go out as one review; nothing is sent until
 * the person confirms.
 */
export function PortfolioImportAssetReviewStep({ groups, existingAssets, palette, busy, onSubmit }: PortfolioImportAssetReviewStepProps) {
  const { t } = useTranslation()
  const [choices, setChoices] = useState<Readonly<Record<number, PortfolioImportAssetChoice>>>(() => recommendedChoices(groups))

  const resolvedCount = groups.filter((group) => choices[group.id] !== undefined).length
  const allResolved = groups.length > 0 && resolvedCount === groups.length

  const submit = async () => {
    if (!allResolved || busy) return
    await onSubmit(groups.map((group) => decisionForChoice(group.id, choices[group.id]!)))
  }

  return (
    <View style={styles.step}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('portfolioImport.assetReview.title')}</Text>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioImport.assetReview.helper')}</Text>
        <Text style={[styles.progress, { color: palette.mutedForeground }]}>{t('portfolioImport.assetReview.progress', { resolved: resolvedCount, total: groups.length })}</Text>
      </View>

      {groups.map((group) => (
        <PortfolioImportAssetGroupCard
          key={group.id}
          group={group}
          existingAssets={existingAssets}
          palette={palette}
          choice={choices[group.id] ?? null}
          disabled={busy}
          onChoose={(choice) => setChoices((current) => ({ ...current, [group.id]: choice }))}
          onClear={() => setChoices((current) => {
            const { [group.id]: _cleared, ...rest } = current
            return rest
          })}
        />
      ))}

      <PortfolioButton
        label={busy ? t('portfolioImport.assetReview.submitting') : t('portfolioImport.assetReview.submit')}
        onPress={submit}
        palette={palette}
        disabled={!allResolved || busy}
        busy={busy}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  step: { gap: themeTokens.spacing[4] },
  heading: { gap: themeTokens.spacing[1] },
  title: { ...textStyles.section },
  helper: { ...textStyles.body },
  progress: { ...textStyles.amountSmall },
})
