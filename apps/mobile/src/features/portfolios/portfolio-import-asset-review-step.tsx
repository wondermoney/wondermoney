import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { PortfolioImportAssetGroupCard } from './portfolio-import-asset-group-card'
import type { PortfolioImportAssetGroupDto, PortfolioImportAssetGroupResolution } from './portfolio-import-contract'
import { PortfolioButton, type PortfolioPalette } from './portfolio-form-parts'
import type { PortfolioImportAssetGroupMapping } from './use-portfolio-import'

export type PortfolioImportAssetReviewStepProps = Readonly<{
  groups: readonly PortfolioImportAssetGroupDto[]
  palette: PortfolioPalette
  busy: boolean
  onSubmit: (mappings: readonly PortfolioImportAssetGroupMapping[]) => void | Promise<void>
}>

/**
 * The asset-matching reconciliation step web calls PortfolioImportAssetReviewStep: one
 * card per ambiguous/unmatched/provider-error group. Resolutions are held locally until every group
 * has one, then submitted as a single "confirm asset mappings" batch — nothing is sent to the
 * server until the user explicitly confirms.
 */
export function PortfolioImportAssetReviewStep({ groups, palette, busy, onSubmit }: PortfolioImportAssetReviewStepProps) {
  const { t } = useTranslation()
  const [resolutions, setResolutions] = useState<Readonly<Record<number, PortfolioImportAssetGroupResolution>>>({})

  const resolvedCount = useMemo(() => groups.filter((group) => resolutions[group.id] !== undefined).length, [groups, resolutions])
  const allResolved = groups.length > 0 && resolvedCount === groups.length

  const submit = async () => {
    if (!allResolved || busy) return
    const mappings: readonly PortfolioImportAssetGroupMapping[] = groups.map((group) => ({
      assetGroupId: group.id,
      resolution: resolutions[group.id]!,
    }))
    await onSubmit(mappings)
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
          palette={palette}
          resolution={resolutions[group.id] ?? null}
          disabled={busy}
          // A resolved card's own "Change" button re-submits its current resolution — treat that
          // as a request to go back to editing rather than a real (identical) re-selection.
          onResolve={(resolution) => setResolutions((current) => {
            if (current[group.id] !== undefined) {
              const { [group.id]: _removed, ...rest } = current
              return rest
            }
            return { ...current, [group.id]: resolution }
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
