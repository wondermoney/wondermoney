import { SymbolView } from 'expo-symbols'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioPalette } from './portfolio-form-parts'

/**
 * A fee the API could not convert to the user's currency is counted as zero. Says so next to the
 * figure it affects. The warning glyph and the words carry the state; the amber ink only adds to it.
 * `compact` is the short label used inside a holding row, which announces the full sentence.
 */
export function FeeConversionNotice({ scope, palette, compact = false }: { scope: 'holding' | 'gains'; palette: PortfolioPalette; compact?: boolean }) {
  const { t } = useTranslation()
  const message = t(scope === 'holding' ? 'portfolioFees.holding' : 'portfolioFees.gains')
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={message} testID={`fee-conversion-notice-${scope}`} style={styles.row}>
      <SymbolView name={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }} size={14} tintColor={palette.warningText} />
      <Text allowFontScaling style={[styles.text, { color: palette.warningText }]}>
        {compact ? t('portfolioFees.holdingLabel') : message}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[1] },
  text: { ...textStyles.meta, flexShrink: 1 },
})
